import json

from fastapi.testclient import TestClient

from app.core import settings as settings_module
from app.main import create_app
from app.models.agent import AgentSession
from app.models.asset import Asset, AssetAnalysis, AssetAnalysisStatus, AssetType, AudioAnalysis
from app.services.agent_context import AgentContextBuilder
from app.services.agent_llm import DeepSeekLLMProvider, LLMOutputParseError, RawJsonLLMProvider


def make_client(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv("VIDEO_MAKER_STORAGE_DIR", str(tmp_path))
    monkeypatch.setenv("VIDEO_MAKER_GLOBAL_RENDER_PATH", "/global/videos/{job_id}")
    monkeypatch.setenv("VIDEO_MAKER_AGENT_LLM_PROVIDER", "mock")
    monkeypatch.delenv("VIDEO_MAKER_DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    settings_module.get_settings.cache_clear()
    return TestClient(create_app())


def create_asset(client: TestClient, payload: dict) -> dict:
    response = client.post("/api/v1/assets", json=payload)
    assert response.status_code == 201
    return response.json()["asset"]


def test_context_builder_includes_system_assets_history_spec_and_tool() -> None:
    asset = Asset(
        id="music-1",
        type=AssetType.music,
        url="https://example.com/music.mp3",
        tag="romantic",
        description="Warm piano music",
        analysis_status=AssetAnalysisStatus.ready,
        analysis=AssetAnalysis(
            audio=AudioAnalysis(
                bpm=92,
                beat_sync_recommended=True,
                beat_markers=[{"time_seconds": 8.2, "confidence": 0.88, "label": "beat"}],
            )
        ),
    )
    session = AgentSession(
        id="session-1",
        system_prompt="你是婚礼视频导演。",
        asset_ids=[asset.id],
        history=[],
    )

    messages = AgentContextBuilder().build_messages(
        session=session,
        assets=[asset],
        user_message="生成一个温馨视频",
    )

    system = messages[0]["content"]
    assert "你是婚礼视频导演" in system
    assert "资源列表" in system
    assert "music-1" in system
    assert "beat_sync_recommended" in system
    assert "generate_video" in system
    assert messages[-1]["content"] == "生成一个温馨视频"


def test_agent_session_message_generates_video_manifest(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    photo = create_asset(
        client,
        {
            "type": "photo",
            "url": "https://example.com/ceremony.jpg",
            "tag": "ceremony",
            "description": "The ceremony kiss",
            "analysis_status": "ready",
            "analysis": {"visual": {"detected_tags": ["ceremony", "couple"]}},
        },
    )
    video = create_asset(
        client,
        {
            "type": "video",
            "url": "https://example.com/dance.mp4",
            "tag": "dance",
            "description": "First dance clip",
            "analysis_status": "ready",
            "analysis": {"visual": {"duration_seconds": 8, "mood": "warm"}},
        },
    )
    music = create_asset(
        client,
        {
            "type": "music",
            "url": "https://example.com/music.mp3",
            "tag": "romantic",
            "analysis_status": "ready",
            "analysis": {
                "audio": {
                    "bpm": 92,
                    "beat_sync_recommended": True,
                    "beat_markers": [{"time_seconds": 8.2, "confidence": 0.9}],
                }
            },
        },
    )

    session_response = client.post(
        "/api/v1/agent/sessions",
        json={
            "system_prompt": "你是婚礼视频导演，只输出可渲染的视频脚本。",
            "asset_ids": [photo["id"], video["id"], music["id"]],
        },
    )
    assert session_response.status_code == 201
    session = session_response.json()["session"]

    run_response = client.post(
        f"/api/v1/agent/sessions/{session['id']}/messages",
        json={"message": "做一个温馨婚礼开场，音乐卡点一点"},
    )

    assert run_response.status_code == 200
    payload = run_response.json()
    run = payload["run"]
    session = payload["session"]
    assert run["status"] == "completed"
    assert run["spec_id"]
    assert run["render_job_id"]
    assert run["tool_result"]["manifest_url"].endswith("/manifest")
    assert run["tool_result"]["output_url"] is None
    assert run["tool_result"]["global_render_path"] == f"/global/videos/{run['render_job_id']}"
    assert [section["name"] for section in run["context_sections"]] == [
        "system_prompt",
        "resources",
        "history",
        "current_spec",
        "tool",
        "output_contract",
        "user_message",
    ]
    assert "The ceremony kiss" in run["context_sections"][1]["content"]
    assert session["current_spec_id"] == run["spec_id"]
    assert [message["role"] for message in session["history"]][-3:] == ["user", "assistant", "tool"]

    manifest_response = client.get(run["tool_result"]["manifest_url"])
    assert manifest_response.status_code == 200
    manifest = manifest_response.json()
    assert manifest["spec"]["music_asset_id"] == music["id"]
    assert manifest["spec"]["timeline"][1]["caption"] == "The ceremony kiss"


def test_agent_history_is_used_on_followup(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    photo = create_asset(
        client,
        {
            "type": "photo",
            "url": "https://example.com/ceremony.jpg",
            "tag": "ceremony",
            "description": "The ceremony",
        },
    )
    session = client.post(
        "/api/v1/agent/sessions",
        json={"system_prompt": "你是视频导演。", "asset_ids": [photo["id"]]},
    ).json()["session"]

    first = client.post(
        f"/api/v1/agent/sessions/{session['id']}/messages",
        json={"message": "先生成一个版本"},
    )
    assert first.status_code == 200
    second = client.post(
        f"/api/v1/agent/sessions/{session['id']}/messages",
        json={"message": "再改得更浪漫"},
    )

    assert second.status_code == 200
    history = second.json()["session"]["history"]
    user_messages = [message["content"] for message in history if message["role"] == "user"]
    assert user_messages == ["先生成一个版本", "再改得更浪漫"]


def test_create_agent_session_unknown_asset_returns_422(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)

    response = client.post(
        "/api/v1/agent/sessions",
        json={"system_prompt": "你是视频导演。", "asset_ids": ["missing"]},
    )

    assert response.status_code == 422
    assert "Unknown asset_id" in response.json()["detail"]


def test_send_message_unknown_session_returns_404(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)

    response = client.post(
        "/api/v1/agent/sessions/missing/messages",
        json={"message": "生成视频"},
    )

    assert response.status_code == 404


def test_raw_json_llm_provider_reports_invalid_json() -> None:
    provider = RawJsonLLMProvider("not json")

    try:
        provider.complete([], [])
    except LLMOutputParseError as exc:
        assert "Invalid LLM decision JSON" in str(exc)
    else:
        raise AssertionError("Expected RawJsonLLMProvider to reject invalid JSON")


def test_deepseek_provider_parses_json_response(monkeypatch) -> None:
    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return (
                b'{"choices":[{"message":{"content":'
                b'"{\\"assistant_message\\":\\"ok\\",'
                b'\\"video_spec\\":null,'
                b'\\"should_call_generate_video\\":false}"}}]}'
            )

    captured = {}

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["timeout"] = timeout
        captured["body"] = request.data.decode("utf-8")
        captured["authorization"] = request.headers["Authorization"]
        return FakeResponse()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    provider = DeepSeekLLMProvider(api_key="test-key", timeout_seconds=12)

    decision = provider.complete([{"role": "user", "content": "hi"}], [])

    assert decision.assistant_message == "ok"
    assert decision.should_call_generate_video is False
    assert captured["url"] == "https://api.deepseek.com/chat/completions"
    assert captured["timeout"] == 12
    assert captured["authorization"] == "Bearer test-key"
    body = captured["body"]
    assert "deepseek-v4-pro" in body
    assert "json_object" in body


def test_deepseek_provider_repairs_non_contract_video_json(monkeypatch) -> None:
    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            content = {
                "assistant_message": "已生成婚礼视频方案",
                "should_call_generate_video": True,
                "video_spec": {
                    "resolution": {"width": 1080, "height": 1920},
                    "scenes": [
                        {"duration": 3, "text": "Opening"},
                        {"duration": 6, "caption": "Ceremony kiss"},
                    ],
                    "music": {"start_time": 0, "end_time": 30, "volume": 1.0},
                },
            }
            return json_response(content)

    def fake_urlopen(request, timeout):
        return FakeResponse()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    provider = DeepSeekLLMProvider(api_key="test-key")
    system = (
        "资源列表:\n"
        "["
        "{\"id\":\"photo-1\",\"type\":\"photo\",\"url\":\"https://example.com/a.jpg\","
        "\"tag\":\"ceremony\",\"description\":\"The ceremony kiss\",\"analysis\":{}},"
        "{\"id\":\"music-1\",\"type\":\"music\",\"url\":\"https://example.com/a.mp3\","
        "\"tag\":\"romantic\",\"analysis\":{}}"
        "]\n\n"
        "输出约束"
    )

    decision = provider.complete(
        [{"role": "system", "content": system}, {"role": "user", "content": "做一个竖版婚礼视频"}],
        [],
    )

    assert decision.should_call_generate_video is True
    assert decision.video_spec is not None
    assert decision.video_spec.aspect_ratio == "9:16"
    assert decision.video_spec.template_id == "classic_wedding"
    assert decision.video_spec.music_asset_id == "music-1"
    assert decision.video_spec.timeline[1].asset_id == "photo-1"
    assert decision.video_spec.duration_seconds == sum(
        scene.duration_seconds for scene in decision.video_spec.timeline
    )


def json_response(content: dict) -> bytes:
    return json.dumps(
        {"choices": [{"message": {"content": json.dumps(content, ensure_ascii=False)}}]},
        ensure_ascii=False,
    ).encode("utf-8")
