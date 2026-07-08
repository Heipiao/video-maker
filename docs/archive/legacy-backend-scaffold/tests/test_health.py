from fastapi.testclient import TestClient

from app.core.settings import get_settings
from app.main import app


def test_health():
    client = TestClient(app)
    assert client.get("/health").json() == {"status": "ok"}


def test_story_generation_returns_social_content_system(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    get_settings.cache_clear()
    client = TestClient(app)
    project_response = client.post(
        "/projects",
        json={
            "video_type": "nostalgia_love_story",
            "couple_names": "Emma & Noah",
            "wedding_date": "2026-09-12",
            "location": "Napa Valley, CA",
            "style": "nostalgic",
            "aspect_ratio": "9:16",
        },
    )
    project_response.raise_for_status()
    project_id = project_response.json()["project"]["id"]

    story_response = client.post(
        f"/projects/{project_id}/story",
        json={
            "tone": "specific, candid, social-first",
            "notes": "Her grandma's dress and a chaotic college-friends dance floor.",
        },
    )
    story_response.raise_for_status()
    story = story_response.json()["story"]

    assert story["hook"]
    assert story["beats"]
    assert story["shot_list"]
    assert story["missing_assets"]
    assert story["platform_plan"]
    assert story["edit_notes"]
    get_settings.cache_clear()
