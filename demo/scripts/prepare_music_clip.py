#!/usr/bin/env python3
import argparse
import subprocess
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Trim a music track to target video duration with fade in/out.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--fade-in", type=float, default=1.2)
    parser.add_argument("--fade-out", type=float, default=3.5)
    parser.add_argument("--bitrate", default="192k")
    args = parser.parse_args()

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    fade_out_start = max(0, args.duration - args.fade_out)
    audio_filter = f"afade=t=in:st=0:d={args.fade_in},afade=t=out:st={fade_out_start}:d={args.fade_out}"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            args.input,
            "-t",
            str(args.duration),
            "-af",
            audio_filter,
            "-c:a",
            "libmp3lame",
            "-b:a",
            args.bitrate,
            str(out),
        ],
        check=True,
    )


if __name__ == "__main__":
    main()
