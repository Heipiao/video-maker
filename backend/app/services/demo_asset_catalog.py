import json
from functools import lru_cache
from pathlib import Path
from typing import Any


def project_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "demo/assets").exists():
            return parent
    return current.parents[2]


def demo_assets_dir() -> Path:
    return project_root() / "demo/assets"


def _demo_url(local_path: Path) -> str:
    relative = local_path.relative_to(demo_assets_dir())
    return f"/demo-assets/{relative.as_posix()}"


def _image_dimensions(local_path: Path) -> dict[str, int]:
    data = local_path.read_bytes()
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return {"width": int.from_bytes(data[16:20], "big"), "height": int.from_bytes(data[20:24], "big")}

    if not data.startswith(b"\xff\xd8"):
        return {}

    index = 2
    start_of_frame_markers = {
        0xC0,
        0xC1,
        0xC2,
        0xC3,
        0xC5,
        0xC6,
        0xC7,
        0xC9,
        0xCA,
        0xCB,
        0xCD,
        0xCE,
        0xCF,
    }
    while index + 9 < len(data):
        if data[index] != 0xFF:
            index += 1
            continue
        while index < len(data) and data[index] == 0xFF:
            index += 1
        if index >= len(data):
            break
        marker = data[index]
        index += 1
        if marker in {0xD8, 0xD9}:
            continue
        if index + 2 > len(data):
            break
        segment_length = int.from_bytes(data[index : index + 2], "big")
        if segment_length < 2 or index + segment_length > len(data):
            break
        if marker in start_of_frame_markers and segment_length >= 7:
            height = int.from_bytes(data[index + 3 : index + 5], "big")
            width = int.from_bytes(data[index + 5 : index + 7], "big")
            return {"width": width, "height": height}
        index += segment_length
    return {}


@lru_cache
def list_demo_assets() -> list[dict[str, Any]]:
    root = project_root()
    image_plan_path = root / "demo/data/image_generation_plan.demo.json"
    music_manifest_path = root / "demo/assets/music_mixkit/manifest.json"
    if not music_manifest_path.exists():
        music_manifest_path = Path(__file__).resolve().parents[1] / "data/music_mixkit_manifest.json"

    assets: list[dict[str, Any]] = []
    if image_plan_path.exists():
        image_plan = json.loads(image_plan_path.read_text(encoding="utf-8"))
        for item in image_plan.get("assets", []):
            local_path = root / "demo/assets/photos_tagged_generated" / f"{item['id']}.jpg"
            dimensions = _image_dimensions(local_path)
            assets.append(
                {
                    "id": item["id"],
                    "type": "photo",
                    "url": _demo_url(local_path),
                    "tag": item["tags"][0] if item.get("tags") else item["moment"],
                    "tags": item.get("tags", []),
                    "moment": item.get("moment"),
                    "description": item.get("prompt"),
                    "analysis_status": "ready",
                    "analysis": {
                        "visual": {
                            "description": item.get("prompt"),
                            "detected_tags": item.get("tags", []),
                            "mood": "romantic",
                        }
                    },
                    "metadata": {"source": "tag_first_generated_demo", **dimensions},
                }
            )

    if music_manifest_path.exists():
        music_manifest = json.loads(music_manifest_path.read_text(encoding="utf-8"))
        for track in music_manifest.get("tracks", []):
            local_path = root / track["local_path"]
            url = track.get("asset_url") or ""
            if local_path.exists():
                url = _demo_url(local_path)
            assets.append(
                {
                    "id": track["id"],
                    "type": "music",
                    "url": url,
                    "tag": track["tags"][0] if track.get("tags") else "music",
                    "tags": track.get("tags", []),
                    "title": track.get("title"),
                    "description": ", ".join(track.get("wedding_use", [])),
                    "analysis_status": "ready",
                    "analysis": {
                        "audio": {
                            "description": track.get("title"),
                            "duration_seconds": track.get("duration_seconds"),
                            "mood": "romantic" if "romantic" in track.get("tags", []) else None,
                            "beat_sync_recommended": False,
                        }
                    },
                    "metadata": {
                        "artist": track.get("artist"),
                        "source": music_manifest.get("source"),
                        "license_note": music_manifest.get("license_note"),
                    },
                }
            )

    return assets
