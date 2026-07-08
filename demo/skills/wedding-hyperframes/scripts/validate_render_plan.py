#!/usr/bin/env python3
import json
import sys
from pathlib import Path


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"file not found: {path}")
    except json.JSONDecodeError as exc:
        fail(f"invalid JSON at line {exc.lineno}: {exc.msg}")


def validate(plan: dict) -> None:
    for key in ["render_plan_version", "project_id", "template_id", "output", "theme", "audio", "scenes", "asset_catalog"]:
        if key not in plan:
            fail(f"missing top-level field: {key}")

    output = plan["output"]
    duration = output.get("duration_seconds")
    if not isinstance(duration, (int, float)) or duration <= 0:
        fail("output.duration_seconds must be positive")

    assets = plan["asset_catalog"]
    if not isinstance(assets, list) or not assets:
        fail("asset_catalog must be a non-empty list")

    asset_ids = set()
    for asset in assets:
        asset_id = asset.get("id")
        if not asset_id:
            fail("asset missing id")
        if asset_id in asset_ids:
            fail(f"duplicate asset id: {asset_id}")
        asset_ids.add(asset_id)
        if asset.get("orientation") not in {"portrait", "landscape", "square"}:
            fail(f"{asset_id} has invalid orientation")
        if not asset.get("tags"):
            fail(f"{asset_id} must include at least one tag")
        score = asset.get("quality_score")
        if not isinstance(score, (int, float)) or score < 0 or score > 1:
            fail(f"{asset_id} quality_score must be between 0 and 1")

    scenes = plan["scenes"]
    if not isinstance(scenes, list) or not scenes:
        fail("scenes must be a non-empty list")

    cursor = 0.0
    seen_scene_ids = set()
    for scene in scenes:
        scene_id = scene.get("id")
        if not scene_id:
            fail("scene missing id")
        if scene_id in seen_scene_ids:
            fail(f"duplicate scene id: {scene_id}")
        seen_scene_ids.add(scene_id)

        start = scene.get("start")
        scene_duration = scene.get("duration")
        if not isinstance(start, (int, float)) or not isinstance(scene_duration, (int, float)):
            fail(f"{scene_id} start and duration must be numeric")
        if abs(start - cursor) > 0.001:
            fail(f"{scene_id} starts at {start}, expected {cursor}")
        if scene_duration <= 0:
            fail(f"{scene_id} duration must be positive")

        for asset_id in scene.get("assets", []):
            if asset_id not in asset_ids:
                fail(f"{scene_id} references missing asset: {asset_id}")
        cursor += scene_duration

    if abs(cursor - duration) > 0.001:
        fail(f"scene duration total {cursor} does not match output duration {duration}")


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: validate_render_plan.py <render_plan.json>")
    path = Path(sys.argv[1])
    validate(load_json(path))
    print(f"OK: {path} is a valid wedding render plan")


if __name__ == "__main__":
    main()
