#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def score_track(track: dict, target_seconds: float, tags: set[str]) -> tuple[float, dict]:
    duration = float(track.get("duration_seconds", 0))
    track_tags = set(track.get("tags", [])) | set(track.get("wedding_use", []))
    tag_hits = sorted(tags & track_tags)
    tag_score = len(tag_hits) * 20
    enough_duration = duration >= target_seconds
    duration_penalty = abs(duration - target_seconds) / 10
    if enough_duration:
        duration_score = max(0, 20 - duration_penalty)
    else:
        duration_score = -50 - (target_seconds - duration)
    wedding_bonus = 10 if "wedding" in track_tags else 0
    total = tag_score + duration_score + wedding_bonus
    details = {
        "score": round(total, 2),
        "tag_hits": tag_hits,
        "duration_delta": round(duration - target_seconds, 3),
        "needs_loop": not enough_duration,
        "can_trim": enough_duration,
    }
    return total, details


def main() -> None:
    parser = argparse.ArgumentParser(description="Rank Mixkit music tracks for a target wedding video duration.")
    parser.add_argument("--manifest", default="demo/assets/music_mixkit/manifest.json")
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--tags", default="", help="Comma-separated tags such as wedding,romantic,vows")
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    tags = {tag.strip().lower().replace(" ", "-") for tag in args.tags.split(",") if tag.strip()}

    ranked = []
    for track in manifest["tracks"]:
        _, details = score_track(track, args.duration, tags)
        ranked.append(
            {
                "id": track["id"],
                "title": track["title"],
                "artist": track["artist"],
                "duration_seconds": track["duration_seconds"],
                "filename": track["filename"],
                "tags": track["tags"],
                "wedding_use": track["wedding_use"],
                **details,
            }
        )
    ranked.sort(key=lambda item: item["score"], reverse=True)
    print(json.dumps(ranked[: args.limit], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
