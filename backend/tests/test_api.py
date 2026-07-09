import os
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core import settings as settings_module
from app.main import create_app
from app.models.asset import Asset, AssetType
from app.models.render import RenderJob
from app.models.spec import TimelineScene, WeddingVideoSpec
from app.services.eci_launcher import EciLaunchResult, EciLaunchRequest, EciLauncher


CLOUD_ENV_DEFAULTS = {
    "VIDEO_MAKER_OSS_ENABLED": "false",
    "VIDEO_MAKER_OSS_ENDPOINT": "",
    "VIDEO_MAKER_OSS_BUCKET": "",
    "VIDEO_MAKER_OSS_ACCESS_KEY_ID": "",
    "VIDEO_MAKER_OSS_ACCESS_KEY_SECRET": "",
    "VIDEO_MAKER_OSS_PUBLIC_BASE_URL": "",
    "VIDEO_MAKER_ALIYUN_ACCESS_KEY_ID": "",
    "VIDEO_MAKER_ALIYUN_ACCESS_KEY_SECRET": "",
    "VIDEO_MAKER_RENDER_CALLBACK_BASE_URL": "",
    "VIDEO_MAKER_RENDER_CALLBACK_TOKEN": "",
}


def make_client(tmp_path, monkeypatch) -> TestClient:
    for key, value in CLOUD_ENV_DEFAULTS.items():
        if key not in os.environ:
            monkeypatch.setenv(key, value)
    monkeypatch.setenv("VIDEO_MAKER_STORAGE_DIR", str(tmp_path))
    settings_module.get_settings.cache_clear()
    return TestClient(create_app())


def create_asset(client: TestClient, asset_type: str, tag: str, caption: str | None = None) -> dict:
    response = client.post(
        "/api/v1/assets",
        json={
            "type": asset_type,
            "url": f"https://example.com/{tag}.jpg",
            "tag": tag,
            "description": caption,
            "caption": caption,
            "metadata": {"source": "test"},
        },
    )
    assert response.status_code == 201
    return response.json()["asset"]


def test_health_and_templates(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)

    health = client.get("/health")
    templates = client.get("/api/v1/templates")

    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert templates.status_code == 200
    template = templates.json()["templates"][0]
    assert template["id"] == "classic_wedding"
    assert "editable_schema" in template
    assert "style" in template["editable_schema"]


def test_builtin_demo_assets_are_served(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)

    response = client.get("/api/v1/demo-assets")

    assert response.status_code == 200
    assets = response.json()["assets"]
    photos = [asset for asset in assets if asset["type"] == "photo"]
    music = [asset for asset in assets if asset["type"] == "music"]
    assert len(photos) == 12
    assert len(music) >= 6
    assert photos[0]["url"].endswith("/photos_tagged_generated/photo_001.jpg")
    assert music[0]["url"].endswith(".mp3")
    image = client.get(photos[0]["url"])
    assert image.status_code == 200


def test_create_and_fetch_asset(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)

    response = client.post(
        "/api/v1/assets",
        json={
            "type": "photo",
            "url": "https://example.com/ceremony.jpg",
            "tag": "ceremony",
            "description": "A ceremony photo with the couple standing together",
            "metadata": {"width": 1920, "height": 1080},
            "analysis_status": "ready",
            "analysis": {
                "visual": {
                    "description": "Outdoor wedding ceremony",
                    "detected_tags": ["couple", "ceremony", "flowers"],
                    "people_count": 2,
                    "mood": "romantic",
                    "quality_score": 0.91,
                    "dominant_colors": ["#FFFFFF", "#C9A86A"],
                }
            },
        },
    )
    assert response.status_code == 201
    asset = response.json()["asset"]
    response = client.get(f"/api/v1/assets/{asset['id']}")

    assert response.status_code == 200
    assert response.json()["asset"]["tag"] == "ceremony"
    assert response.json()["asset"]["description"] == (
        "A ceremony photo with the couple standing together"
    )
    assert response.json()["asset"]["analysis_status"] == "ready"
    assert response.json()["asset"]["analysis"]["visual"]["people_count"] == 2


def test_advisor_options_use_registered_assets(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    photo = create_asset(client, "photo", "ceremony", "The ceremony")
    music = create_asset(client, "music", "romantic", "Soft piano")

    response = client.post(
        "/api/v1/advisor/options",
        json={
            "couple_names": "Alice & Bob",
            "wedding_date": "2026-09-12",
            "location": "Napa Valley",
            "asset_ids": [photo["id"], music["id"]],
        },
    )

    assert response.status_code == 200
    options = response.json()["options"]
    assert len(options) == 3
    assert options[0]["id"] == "warm_cinematic"
    assert options[0]["template_id"] == "classic_wedding"
    assert options[0]["aspect_ratio"] == "9:16"
    assert "Alice & Bob" in options[0]["prompt"]


def test_upload_file_returns_served_url(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)

    response = client.post(
        "/api/v1/uploads",
        files={"file": ("cover.jpg", b"fake-image-bytes", "image/jpeg")},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["filename"] == "cover.jpg"
    assert payload["content_type"] == "image/jpeg"
    assert payload["size_bytes"] == len(b"fake-image-bytes")
    assert payload["suggested_asset_type"] == "photo"

    uploaded = client.get(payload["url"])
    assert uploaded.status_code == 200
    assert uploaded.content == b"fake-image-bytes"


def test_create_music_asset_with_beat_analysis(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)

    response = client.post(
        "/api/v1/assets",
        json={
            "type": "music",
            "url": "https://example.com/romantic.mp3",
            "tag": "romantic",
            "description": "Soft piano music suitable for a wedding opening",
            "analysis_status": "ready",
            "analysis": {
                "audio": {
                    "description": "Warm piano track with a steady pulse",
                    "duration_seconds": 62.5,
                    "bpm": 92,
                    "energy": 0.42,
                    "mood": "warm",
                    "beat_sync_recommended": True,
                    "beat_markers": [
                        {"time_seconds": 0, "confidence": 0.9, "label": "intro"},
                        {"time_seconds": 8.2, "confidence": 0.88, "label": "beat"},
                    ],
                    "spectrum_summary": {"low": 0.2, "mid": 0.5, "high": 0.3},
                }
            },
        },
    )

    assert response.status_code == 201
    asset = response.json()["asset"]
    assert asset["analysis"]["audio"]["beat_sync_recommended"] is True
    assert asset["analysis"]["audio"]["beat_markers"][1]["time_seconds"] == 8.2


def test_generate_save_render_and_manifest_flow(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    photo_a = create_asset(client, "photo", "ceremony", "The ceremony")
    photo_b = create_asset(client, "photo", "rings", "The rings")
    music = create_asset(client, "music", "romantic")

    generated = client.post(
        "/api/v1/video-specs/generate",
        json={
            "template_id": "classic_wedding",
            "title": "Alice & Bob",
            "asset_ids": [photo_a["id"], photo_b["id"], music["id"]],
            "aspect_ratio": "16:9",
        },
    )

    assert generated.status_code == 200
    spec = generated.json()["spec"]
    assert spec["music_asset_id"] == music["id"]
    assert spec["duration_seconds"] == sum(scene["duration_seconds"] for scene in spec["timeline"])
    assert spec["timeline"][1]["asset_id"] == photo_a["id"]

    spec["style"]["primary_color"] = "#112233"
    spec["timeline"][1]["caption"] = "Edited ceremony caption"
    saved = client.put(f"/api/v1/video-specs/{spec['id']}", json={"spec": spec})

    assert saved.status_code == 200
    saved_spec = saved.json()["spec"]
    assert saved_spec["style"]["primary_color"] == "#112233"
    assert saved_spec["timeline"][1]["caption"] == "Edited ceremony caption"

    job_response = client.post("/api/v1/render-jobs", json={"spec_id": spec["id"]})
    assert job_response.status_code == 202
    job = job_response.json()["job"]
    assert job["status"] == "queued"
    assert job["output_url"] is None
    assert job["manifest_url"].endswith("/manifest")

    fetched_job = client.get(f"/api/v1/render-jobs/{job['id']}")
    assert fetched_job.status_code == 200
    assert fetched_job.json()["job"]["id"] == job["id"]

    manifest_response = client.get(job["manifest_url"])
    assert manifest_response.status_code == 200
    manifest = manifest_response.json()
    assert manifest["job_id"] == job["id"]
    assert manifest["renderer"]["name"] == "manifest"
    assert manifest["spec"]["style"]["primary_color"] == "#112233"
    assert manifest["spec"]["timeline"][1]["caption"] == "Edited ceremony caption"
    assert len(manifest["spec"]["assets"]) == 3


def test_remotion_render_without_command_returns_clear_error(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VIDEO_MAKER_REMOTION_COMMAND", "")
    client = make_client(tmp_path, monkeypatch)
    photo = create_asset(client, "photo", "ceremony", "The ceremony")

    spec = client.post(
        "/api/v1/video-specs/generate",
        json={
            "template_id": "classic_wedding",
            "title": "Alice & Bob",
            "asset_ids": [photo["id"]],
            "aspect_ratio": "16:9",
        },
    ).json()["spec"]
    job = client.post("/api/v1/render-jobs", json={"spec_id": spec["id"]}).json()["job"]

    response = client.post(f"/api/v1/render-jobs/{job['id']}/remotion")

    assert response.status_code == 422
    assert "VIDEO_MAKER_REMOTION_COMMAND" in response.json()["detail"]
    failed_job = client.get(f"/api/v1/render-jobs/{job['id']}").json()["job"]
    assert failed_job["status"] == "failed"


def test_remotion_render_updates_job_and_serves_video(tmp_path, monkeypatch) -> None:
    command = (
        f"{sys.executable} -c "
        "\"import pathlib,sys; pathlib.Path(sys.argv[1]).write_bytes(b'fake mp4')\" "
        "{output_path}"
    )
    monkeypatch.setenv("VIDEO_MAKER_REMOTION_COMMAND", command)
    client = make_client(tmp_path, monkeypatch)
    photo = create_asset(client, "photo", "ceremony", "The ceremony")

    spec = client.post(
        "/api/v1/video-specs/generate",
        json={
            "template_id": "classic_wedding",
            "title": "Alice & Bob",
            "asset_ids": [photo["id"]],
            "aspect_ratio": "16:9",
        },
    ).json()["spec"]
    job = client.post("/api/v1/render-jobs", json={"spec_id": spec["id"]}).json()["job"]

    response = client.post(f"/api/v1/render-jobs/{job['id']}/remotion")

    assert response.status_code == 200
    rendered_job = response.json()["job"]
    assert rendered_job["status"] == "ready"
    assert rendered_job["renderer"] == "remotion"
    assert rendered_job["output_url"] == f"/outputs/{job['id']}.mp4"
    video = client.get(rendered_job["output_url"])
    assert video.status_code == 200
    assert video.content == b"fake mp4"


def test_remotion_render_uploads_output_to_oss_when_enabled(tmp_path, monkeypatch) -> None:
    command = (
        f"{sys.executable} -c "
        "\"import pathlib,sys; pathlib.Path(sys.argv[1]).write_bytes(b'fake mp4')\" "
        "{output_path}"
    )
    monkeypatch.setenv("VIDEO_MAKER_REMOTION_COMMAND", command)
    monkeypatch.setenv("VIDEO_MAKER_OSS_ENABLED", "true")
    monkeypatch.setenv("VIDEO_MAKER_OSS_ENDPOINT", "https://oss-cn-test.aliyuncs.com")
    monkeypatch.setenv("VIDEO_MAKER_OSS_BUCKET", "wedding-video")
    monkeypatch.setenv("VIDEO_MAKER_OSS_ACCESS_KEY_ID", "test-key")
    monkeypatch.setenv("VIDEO_MAKER_OSS_ACCESS_KEY_SECRET", "test-secret")
    monkeypatch.setenv("VIDEO_MAKER_OSS_PREFIX", "renders")
    monkeypatch.setenv("VIDEO_MAKER_OSS_PUBLIC_BASE_URL", "https://cdn.example.com")
    monkeypatch.setenv("VIDEO_MAKER_OSS_CLEANUP_LOCAL_OUTPUT", "true")
    uploads = []

    class FakeOssResponse:
        status = 200

        def getcode(self) -> int:
            return self.status

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback) -> None:
            return None

    def fake_urlopen(request, timeout):
        uploads.append(
            {
                "url": request.full_url,
                "headers": dict(request.header_items()),
                "data": request.data,
                "timeout": timeout,
            }
        )
        return FakeOssResponse()

    monkeypatch.setattr("app.services.output_storage.urllib.request.urlopen", fake_urlopen)
    client = make_client(tmp_path, monkeypatch)
    photo = create_asset(client, "photo", "ceremony", "The ceremony")
    spec = client.post(
        "/api/v1/video-specs/generate",
        json={
            "template_id": "classic_wedding",
            "title": "Alice & Bob",
            "asset_ids": [photo["id"]],
            "aspect_ratio": "16:9",
        },
    ).json()["spec"]
    job = client.post("/api/v1/render-jobs", json={"spec_id": spec["id"]}).json()["job"]

    response = client.post(f"/api/v1/render-jobs/{job['id']}/remotion")

    assert response.status_code == 200
    rendered_job = response.json()["job"]
    assert rendered_job["status"] == "ready"
    assert rendered_job["output_url"] == f"https://cdn.example.com/renders/{job['id']}.mp4"
    assert uploads[0]["url"] == f"https://wedding-video.oss-cn-test.aliyuncs.com/renders/{job['id']}.mp4"
    assert uploads[0]["headers"]["Content-type"] == "video/mp4"
    assert uploads[0]["headers"]["Authorization"].startswith("OSS test-key:")
    assert uploads[0]["data"] == b"fake mp4"
    assert not Path(tmp_path, "outputs", f"{job['id']}.mp4").exists()


def test_remotion_render_with_incomplete_oss_config_returns_clear_error(tmp_path, monkeypatch) -> None:
    command = (
        f"{sys.executable} -c "
        "\"import pathlib,sys; pathlib.Path(sys.argv[1]).write_bytes(b'fake mp4')\" "
        "{output_path}"
    )
    monkeypatch.setenv("VIDEO_MAKER_REMOTION_COMMAND", command)
    monkeypatch.setenv("VIDEO_MAKER_OSS_ENABLED", "true")
    monkeypatch.delenv("VIDEO_MAKER_OSS_ENDPOINT", raising=False)
    monkeypatch.delenv("VIDEO_MAKER_OSS_BUCKET", raising=False)
    monkeypatch.delenv("VIDEO_MAKER_OSS_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("VIDEO_MAKER_OSS_ACCESS_KEY_SECRET", raising=False)
    client = make_client(tmp_path, monkeypatch)
    photo = create_asset(client, "photo", "ceremony", "The ceremony")
    spec = client.post(
        "/api/v1/video-specs/generate",
        json={
            "template_id": "classic_wedding",
            "title": "Alice & Bob",
            "asset_ids": [photo["id"]],
            "aspect_ratio": "16:9",
        },
    ).json()["spec"]
    job = client.post("/api/v1/render-jobs", json={"spec_id": spec["id"]}).json()["job"]

    response = client.post(f"/api/v1/render-jobs/{job['id']}/remotion")

    assert response.status_code == 422
    assert "OSS endpoint, bucket, access key id, and access key secret" in response.json()["detail"]
    failed_job = client.get(f"/api/v1/render-jobs/{job['id']}").json()["job"]
    assert failed_job["status"] == "failed"


def test_eci_launcher_builds_spot_container_group_request(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VIDEO_MAKER_STORAGE_DIR", str(tmp_path))
    monkeypatch.setenv("VIDEO_MAKER_OSS_ENABLED", "true")
    monkeypatch.setenv("VIDEO_MAKER_OSS_ENDPOINT", "https://oss-cn-test.aliyuncs.com")
    monkeypatch.setenv("VIDEO_MAKER_OSS_BUCKET", "wedding-video")
    monkeypatch.setenv("VIDEO_MAKER_OSS_ACCESS_KEY_ID", "oss-key")
    monkeypatch.setenv("VIDEO_MAKER_OSS_ACCESS_KEY_SECRET", "oss-secret")
    monkeypatch.setenv("VIDEO_MAKER_ALIYUN_ACCESS_KEY_ID", "aliyun-key")
    monkeypatch.setenv("VIDEO_MAKER_ALIYUN_ACCESS_KEY_SECRET", "aliyun-secret")
    monkeypatch.setenv("VIDEO_MAKER_ECI_VSWITCH_ID", "vsw-test")
    monkeypatch.setenv("VIDEO_MAKER_ECI_SECURITY_GROUP_ID", "sg-test")
    monkeypatch.setenv("VIDEO_MAKER_ECI_RENDERER_IMAGE", "registry/render:latest")
    monkeypatch.setenv("VIDEO_MAKER_RENDER_CALLBACK_TOKEN", "callback-token")
    settings_module.get_settings.cache_clear()
    settings = settings_module.get_settings()
    job = RenderJob(id="job-1234567890", spec_id="spec-1", attempt_count=1)

    sdk_request = EciLauncher(settings).build_create_request(
        EciLaunchRequest(
            job=job,
            manifest_url="https://cdn.example.com/wedding-videos/jobs/job-123/manifest.json",
            manifest_oss_key="wedding-videos/jobs/job-123/manifest.json",
            output_oss_key="wedding-videos/jobs/job-123/output.mp4",
            callback_url="https://api.example.com/callback",
            heartbeat_url="https://api.example.com/heartbeat",
            callback_token="callback-token",
        )
    )

    assert sdk_request.region_id == "cn-hangzhou"
    assert sdk_request.v_switch_id == "vsw-test"
    assert sdk_request.security_group_id == "sg-test"
    assert sdk_request.cpu == 4
    assert sdk_request.memory == 8
    assert sdk_request.active_deadline_seconds == 1800
    assert sdk_request.spot_strategy == "SpotAsPriceGo"
    assert sdk_request.strict_spot is False
    assert sdk_request.ephemeral_storage == 50
    container = sdk_request.container[0]
    assert container.image == "registry/render:latest"
    assert container.command == ["python", "-m", "app.worker.render_job"]
    env = {item.key: item.value for item in container.environment_var}
    assert env["VIDEO_MAKER_JOB_ID"] == "job-1234567890"
    assert env["VIDEO_MAKER_OUTPUT_OSS_KEY"] == "wedding-videos/jobs/job-123/output.mp4"
    assert env["VIDEO_MAKER_RENDER_CALLBACK_TOKEN"] == "callback-token"


def test_eci_launcher_uses_internal_base_url_for_relative_assets(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VIDEO_MAKER_STORAGE_DIR", str(tmp_path))
    monkeypatch.setenv("VIDEO_MAKER_PUBLIC_BASE_URL", "https://video-maker.example.com")
    monkeypatch.setenv("VIDEO_MAKER_RENDER_CALLBACK_BASE_URL", "http://10.0.0.8:8017")
    monkeypatch.setenv("VIDEO_MAKER_OSS_ENABLED", "true")
    monkeypatch.setenv("VIDEO_MAKER_OSS_ENDPOINT", "https://oss-cn-test-internal.aliyuncs.com")
    monkeypatch.setenv("VIDEO_MAKER_OSS_BUCKET", "wedding-video")
    monkeypatch.setenv("VIDEO_MAKER_OSS_ACCESS_KEY_ID", "oss-key")
    monkeypatch.setenv("VIDEO_MAKER_OSS_ACCESS_KEY_SECRET", "oss-secret")
    monkeypatch.setenv("VIDEO_MAKER_ALIYUN_ACCESS_KEY_ID", "aliyun-key")
    monkeypatch.setenv("VIDEO_MAKER_ALIYUN_ACCESS_KEY_SECRET", "aliyun-secret")
    monkeypatch.setenv("VIDEO_MAKER_ECI_VSWITCH_ID", "vsw-test")
    monkeypatch.setenv("VIDEO_MAKER_ECI_SECURITY_GROUP_ID", "sg-test")
    monkeypatch.setenv("VIDEO_MAKER_ECI_RENDERER_IMAGE", "registry/render:latest")
    settings_module.get_settings.cache_clear()
    settings = settings_module.get_settings()
    job = RenderJob(id="job-1234567890", spec_id="spec-1", attempt_count=1)

    sdk_request = EciLauncher(settings).build_create_request(
        EciLaunchRequest(
            job=job,
            manifest_url="http://10.0.0.8:8017/api/v1/render-jobs/job-1234567890/manifest",
            manifest_oss_key="wedding-videos/jobs/job-123/manifest.json",
            output_oss_key="wedding-videos/jobs/job-123/output.mp4",
            callback_url="http://10.0.0.8:8017/api/v1/render-jobs/job-1234567890/callback",
            heartbeat_url="http://10.0.0.8:8017/api/v1/render-jobs/job-1234567890/heartbeat",
            callback_token="callback-token",
        )
    )

    env = {item.key: item.value for item in sdk_request.container[0].environment_var}
    assert env["VIDEO_MAKER_PUBLIC_BASE_URL"] == "http://10.0.0.8:8017"
    assert env["VIDEO_MAKER_ASSET_REWRITE_FROM"] == "https://video-maker.example.com"
    assert env["VIDEO_MAKER_ASSET_REWRITE_TO"] == "http://10.0.0.8:8017"


def test_eci_render_dispatch_uploads_manifest_and_saves_container_group(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("VIDEO_MAKER_OSS_ENABLED", "true")
    monkeypatch.setenv("VIDEO_MAKER_OSS_ENDPOINT", "https://oss-cn-test-internal.aliyuncs.com")
    monkeypatch.setenv("VIDEO_MAKER_OSS_BUCKET", "wedding-video")
    monkeypatch.setenv("VIDEO_MAKER_OSS_ACCESS_KEY_ID", "oss-key")
    monkeypatch.setenv("VIDEO_MAKER_OSS_ACCESS_KEY_SECRET", "oss-secret")
    monkeypatch.setenv("VIDEO_MAKER_OSS_PUBLIC_BASE_URL", "https://cdn.example.com")
    monkeypatch.setenv("VIDEO_MAKER_OSS_PREFIX", "wedding-videos")
    monkeypatch.setenv("VIDEO_MAKER_ALIYUN_ACCESS_KEY_ID", "aliyun-key")
    monkeypatch.setenv("VIDEO_MAKER_ALIYUN_ACCESS_KEY_SECRET", "aliyun-secret")
    monkeypatch.setenv("VIDEO_MAKER_ECI_VSWITCH_ID", "vsw-test")
    monkeypatch.setenv("VIDEO_MAKER_ECI_SECURITY_GROUP_ID", "sg-test")
    monkeypatch.setenv("VIDEO_MAKER_ECI_RENDERER_IMAGE", "registry/render:latest")
    monkeypatch.setenv("VIDEO_MAKER_RENDER_CALLBACK_BASE_URL", "http://10.0.0.8:8017")
    monkeypatch.setenv("VIDEO_MAKER_RENDER_CALLBACK_TOKEN", "callback-token")
    uploads = []
    launch_requests = []

    class FakeOssResponse:
        status = 200

        def getcode(self) -> int:
            return self.status

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback) -> None:
            return None

    def fake_urlopen(request, timeout):
        uploads.append(
            {
                "url": request.full_url,
                "headers": dict(request.header_items()),
                "data": request.data,
                "timeout": timeout,
            }
        )
        return FakeOssResponse()

    class FakeEciLauncher:
        def __init__(self, settings) -> None:
            self.settings = settings

        def launch(self, request):
            launch_requests.append(request)
            return EciLaunchResult(container_group_id="eci-test-123")

    monkeypatch.setattr("app.services.output_storage.urllib.request.urlopen", fake_urlopen)
    monkeypatch.setattr("app.api.routes.EciLauncher", FakeEciLauncher)
    client = make_client(tmp_path, monkeypatch)
    photo = create_asset(client, "photo", "ceremony", "The ceremony")
    spec = client.post(
        "/api/v1/video-specs/generate",
        json={
            "template_id": "classic_wedding",
            "title": "Alice & Bob",
            "asset_ids": [photo["id"]],
            "aspect_ratio": "16:9",
        },
    ).json()["spec"]
    job = client.post("/api/v1/render-jobs", json={"spec_id": spec["id"]}).json()["job"]

    response = client.post(f"/api/v1/render-jobs/{job['id']}/eci")

    assert response.status_code == 200
    rendered_job = response.json()["job"]
    assert rendered_job["status"] == "rendering"
    assert rendered_job["renderer"] == "eci"
    assert rendered_job["attempt_count"] == 1
    assert rendered_job["max_attempts"] == 3
    assert rendered_job["eci_container_group_id"] == "eci-test-123"
    assert rendered_job["manifest_oss_key"] == f"wedding-videos/jobs/{job['id']}/manifest.json"
    assert rendered_job["output_oss_key"] == f"wedding-videos/jobs/{job['id']}/output.mp4"
    assert rendered_job["manifest_oss_url"] == (
        f"https://cdn.example.com/wedding-videos/jobs/{job['id']}/manifest.json"
    )
    assert uploads[0]["url"] == (
        f"https://wedding-video.oss-cn-test-internal.aliyuncs.com/"
        f"wedding-videos/jobs/{job['id']}/manifest.json"
    )
    assert uploads[0]["headers"]["Content-type"] == "application/json"
    assert b'"job_id":' in uploads[0]["data"]
    assert launch_requests[0].manifest_url == (
        f"http://10.0.0.8:8017/api/v1/render-jobs/{job['id']}/manifest"
    )
    assert launch_requests[0].callback_url == (
        f"http://10.0.0.8:8017/api/v1/render-jobs/{job['id']}/callback"
    )
    assert launch_requests[0].heartbeat_url == (
        f"http://10.0.0.8:8017/api/v1/render-jobs/{job['id']}/heartbeat"
    )
    assert launch_requests[0].output_oss_key == f"wedding-videos/jobs/{job['id']}/output.mp4"
    assert launch_requests[0].callback_token == "callback-token"


def test_eci_render_missing_config_returns_422(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VIDEO_MAKER_OSS_ENABLED", "true")
    monkeypatch.setenv("VIDEO_MAKER_OSS_ENDPOINT", "https://oss-cn-test.aliyuncs.com")
    monkeypatch.setenv("VIDEO_MAKER_OSS_BUCKET", "wedding-video")
    monkeypatch.setenv("VIDEO_MAKER_OSS_ACCESS_KEY_ID", "oss-key")
    monkeypatch.setenv("VIDEO_MAKER_OSS_ACCESS_KEY_SECRET", "oss-secret")
    monkeypatch.setenv("VIDEO_MAKER_ALIYUN_ACCESS_KEY_ID", "aliyun-key")
    monkeypatch.setenv("VIDEO_MAKER_ALIYUN_ACCESS_KEY_SECRET", "aliyun-secret")
    monkeypatch.setenv("VIDEO_MAKER_ECI_VSWITCH_ID", "")
    monkeypatch.setenv("VIDEO_MAKER_ECI_SECURITY_GROUP_ID", "")
    monkeypatch.setenv("VIDEO_MAKER_ECI_RENDERER_IMAGE", "")

    class FakeOssResponse:
        status = 200

        def getcode(self) -> int:
            return self.status

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback) -> None:
            return None

    monkeypatch.setattr(
        "app.services.output_storage.urllib.request.urlopen",
        lambda request, timeout: FakeOssResponse(),
    )
    client = make_client(tmp_path, monkeypatch)
    photo = create_asset(client, "photo", "ceremony", "The ceremony")
    spec = client.post(
        "/api/v1/video-specs/generate",
        json={
            "template_id": "classic_wedding",
            "title": "Alice & Bob",
            "asset_ids": [photo["id"]],
            "aspect_ratio": "16:9",
        },
    ).json()["spec"]
    job = client.post("/api/v1/render-jobs", json={"spec_id": spec["id"]}).json()["job"]

    response = client.post(f"/api/v1/render-jobs/{job['id']}/eci")

    assert response.status_code == 422
    assert "VIDEO_MAKER_ECI_RENDERER_IMAGE" in response.json()["detail"]
    failed_job = client.get(f"/api/v1/render-jobs/{job['id']}").json()["job"]
    assert failed_job["status"] == "failed"


def test_render_job_heartbeat_and_callback_require_token(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("VIDEO_MAKER_RENDER_CALLBACK_TOKEN", "callback-token")
    client = make_client(tmp_path, monkeypatch)
    photo = create_asset(client, "photo", "ceremony", "The ceremony")
    spec = client.post(
        "/api/v1/video-specs/generate",
        json={
            "template_id": "classic_wedding",
            "title": "Alice & Bob",
            "asset_ids": [photo["id"]],
            "aspect_ratio": "16:9",
        },
    ).json()["spec"]
    job = client.post("/api/v1/render-jobs", json={"spec_id": spec["id"]}).json()["job"]

    unauthorized = client.post(
        f"/api/v1/render-jobs/{job['id']}/heartbeat",
        json={"status": "uploading"},
    )
    assert unauthorized.status_code == 401

    heartbeat = client.post(
        f"/api/v1/render-jobs/{job['id']}/heartbeat",
        json={"status": "uploading"},
        headers={"X-Render-Callback-Token": "callback-token"},
    )
    assert heartbeat.status_code == 200
    assert heartbeat.json()["job"]["status"] == "uploading"
    assert heartbeat.json()["job"]["heartbeat_at"] is not None

    ready = client.post(
        f"/api/v1/render-jobs/{job['id']}/callback",
        json={
            "status": "ready",
            "output_url": "https://cdn.example.com/output.mp4",
            "output_oss_key": f"wedding-videos/jobs/{job['id']}/output.mp4",
        },
        headers={"X-Render-Callback-Token": "callback-token"},
    )
    assert ready.status_code == 200
    ready_job = ready.json()["job"]
    assert ready_job["status"] == "ready"
    assert ready_job["output_url"] == "https://cdn.example.com/output.mp4"
    assert ready_job["finished_at"] is not None


def test_render_job_callback_records_preempted_as_retrying(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    photo = create_asset(client, "photo", "ceremony", "The ceremony")
    spec = client.post(
        "/api/v1/video-specs/generate",
        json={
            "template_id": "classic_wedding",
            "title": "Alice & Bob",
            "asset_ids": [photo["id"]],
            "aspect_ratio": "16:9",
        },
    ).json()["spec"]
    job = client.post("/api/v1/render-jobs", json={"spec_id": spec["id"]}).json()["job"]

    preempted = client.post(
        f"/api/v1/render-jobs/{job['id']}/callback",
        json={"status": "preempted", "error": "Spot ECI was reclaimed"},
    )

    assert preempted.status_code == 200
    assert preempted.json()["job"]["status"] == "retrying"
    assert preempted.json()["job"]["error"] == "Spot ECI was reclaimed"


def test_worker_render_job_smoke(monkeypatch) -> None:
    from app.worker import render_job

    posts = []
    uploads = []

    class FakeStorage:
        def upload(self, local_path, object_key):
            uploads.append((local_path.read_bytes(), object_key))
            return "https://cdn.example.com/output.mp4"

        def normalize_key(self, object_key):
            return f"wedding-videos/{object_key.strip('/')}"

    def fake_download(url, target):
        target.write_text('{"job_id":"job-1"}')

    def fake_render(manifest_path, output_path, job_id):
        output_path.write_bytes(b"fake mp4")

    def fake_post(url, payload):
        posts.append((url, payload))

    monkeypatch.setattr(sys, "argv", [
        "render_job",
        "--job-id",
        "job-1",
        "--manifest-url",
        "https://cdn.example.com/manifest.json",
        "--output-oss-key",
        "jobs/job-1/output.mp4",
        "--callback-url",
        "https://api.example.com/callback",
        "--heartbeat-url",
        "https://api.example.com/heartbeat",
    ])
    monkeypatch.setattr(render_job, "_download", fake_download)
    monkeypatch.setattr(render_job, "_render", fake_render)
    monkeypatch.setattr(render_job, "_oss_storage", lambda: FakeStorage())
    monkeypatch.setattr(render_job, "_post_json", fake_post)

    assert render_job.main() == 0
    assert posts[0][1]["status"] == "rendering"
    assert posts[1][1]["status"] == "uploading"
    assert posts[2][1]["status"] == "ready"
    assert posts[2][1]["output_url"] == "https://cdn.example.com/output.mp4"
    assert uploads == [(b"fake mp4", "jobs/job-1/output.mp4")]


def test_generate_spec_uses_asset_description_as_caption(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    photo = client.post(
        "/api/v1/assets",
        json={
            "type": "photo",
            "url": "https://example.com/first-look.jpg",
            "tag": "first_look",
            "description": "The first look before the ceremony",
        },
    ).json()["asset"]

    generated = client.post(
        "/api/v1/video-specs/generate",
        json={
            "template_id": "classic_wedding",
            "title": "Alice & Bob",
            "asset_ids": [photo["id"]],
        },
    )

    assert generated.status_code == 200
    spec = generated.json()["spec"]
    assert spec["timeline"][1]["caption"] == "The first look before the ceremony"


def test_unknown_template_returns_422(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    photo = create_asset(client, "photo", "ceremony")

    response = client.post(
        "/api/v1/video-specs/generate",
        json={
            "template_id": "missing",
            "title": "Alice & Bob",
            "asset_ids": [photo["id"]],
        },
    )

    assert response.status_code == 422
    assert "Unknown template_id" in response.json()["detail"]


def test_missing_asset_returns_422(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)

    response = client.post(
        "/api/v1/video-specs/generate",
        json={
            "template_id": "classic_wedding",
            "title": "Alice & Bob",
            "asset_ids": ["missing"],
        },
    )

    assert response.status_code == 422
    assert "Unknown asset_id" in response.json()["detail"]


def test_invalid_template_style_returns_422(tmp_path, monkeypatch) -> None:
    client = make_client(tmp_path, monkeypatch)
    photo = create_asset(client, "photo", "ceremony")
    generated = client.post(
        "/api/v1/video-specs/generate",
        json={
            "template_id": "modern_story",
            "title": "Alice & Bob",
            "asset_ids": [photo["id"]],
        },
    )
    spec = generated.json()["spec"]
    spec["style"]["transition"] = "crossfade"

    response = client.put(f"/api/v1/video-specs/{spec['id']}", json={"spec": spec})

    assert response.status_code == 422
    assert "Transition is not editable" in response.json()["detail"]


def test_timeline_asset_reference_validation() -> None:
    asset = Asset(
        id="photo-1",
        type=AssetType.photo,
        url="https://example.com/photo.jpg",
        tag="ceremony",
    )

    try:
        WeddingVideoSpec(
            id="spec-1",
            template_id="classic_wedding",
            title="Alice & Bob",
            duration_seconds=9,
            assets=[asset],
            timeline=[
                TimelineScene(type="title", duration_seconds=4, text="Alice & Bob"),
                TimelineScene(type="photo", duration_seconds=5, asset_id="missing"),
            ],
        )
    except ValidationError as exc:
        assert "Unknown scene asset_id" in str(exc)
    else:
        raise AssertionError("Expected WeddingVideoSpec to reject unknown scene asset references")


def test_timeline_duration_validation() -> None:
    asset = Asset(
        id="photo-1",
        type=AssetType.photo,
        url="https://example.com/photo.jpg",
        tag="ceremony",
    )

    try:
        WeddingVideoSpec(
            id="spec-1",
            template_id="classic_wedding",
            title="Alice & Bob",
            duration_seconds=99,
            assets=[asset],
            timeline=[
                TimelineScene(type="title", duration_seconds=4, text="Alice & Bob"),
                TimelineScene(type="photo", duration_seconds=5, asset_id="photo-1"),
            ],
        )
    except ValidationError as exc:
        assert "duration_seconds must equal total timeline duration" in str(exc)
    else:
        raise AssertionError("Expected WeddingVideoSpec to reject mismatched duration")
