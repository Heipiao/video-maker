import argparse
import json
import os
import shlex
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

from app.services.output_storage import AliyunOssOutputStorage


def main() -> int:
    parser = argparse.ArgumentParser(description="Render a VowFrame video job and upload it to OSS.")
    parser.add_argument("--job-id", default=os.getenv("VIDEO_MAKER_JOB_ID"), required=False)
    parser.add_argument("--manifest-url", default=os.getenv("VIDEO_MAKER_MANIFEST_URL"), required=False)
    parser.add_argument(
        "--output-oss-key",
        default=os.getenv("VIDEO_MAKER_OUTPUT_OSS_KEY"),
        required=False,
    )
    parser.add_argument(
        "--callback-url",
        default=os.getenv("VIDEO_MAKER_RENDER_CALLBACK_URL"),
        required=False,
    )
    parser.add_argument(
        "--heartbeat-url",
        default=os.getenv("VIDEO_MAKER_RENDER_HEARTBEAT_URL"),
        required=False,
    )
    args = parser.parse_args()
    _require(args.job_id, "job id")
    _require(args.manifest_url, "manifest url")
    _require(args.output_oss_key, "output OSS key")
    _require(args.callback_url, "callback url")

    try:
        _post_json(args.heartbeat_url, {"status": "rendering", "message": "worker_started"})
        with tempfile.TemporaryDirectory(prefix=f"render-{args.job_id}-") as tmp:
            tmp_dir = Path(tmp)
            manifest_path = tmp_dir / "manifest.json"
            output_path = tmp_dir / "output.mp4"
            _download(args.manifest_url, manifest_path)
            _render(manifest_path, output_path, args.job_id)
            _post_json(args.heartbeat_url, {"status": "uploading", "message": "uploading_output"})
            output_url = _oss_storage().upload(output_path, args.output_oss_key)
        _post_json(
            args.callback_url,
            {
                "status": "ready",
                "output_url": output_url,
                "output_oss_key": _oss_storage().normalize_key(args.output_oss_key),
            },
        )
        return 0
    except Exception as exc:
        status = "preempted" if isinstance(exc, KeyboardInterrupt) else "failed"
        try:
            _post_json(args.callback_url, {"status": status, "error": str(exc)})
        except Exception:
            pass
        raise


def _require(value: str | None, label: str) -> None:
    if not value:
        raise SystemExit(f"Missing {label}")


def _download(url: str, target: Path) -> None:
    with urllib.request.urlopen(url, timeout=120) as response:
        body = response.read()
    if not body:
        raise RuntimeError(f"Downloaded empty manifest from {url}")
    target.write_bytes(body)


def _render(manifest_path: Path, output_path: Path, job_id: str) -> None:
    command_template = os.getenv(
        "VIDEO_MAKER_REMOTION_COMMAND",
        "node remotion/render.mjs {manifest_path} {output_path}",
    )
    command = command_template.format(
        manifest_path=str(manifest_path),
        output_path=str(output_path),
        job_id=job_id,
        spec_id="",
    )
    env = os.environ.copy()
    env["REMOTION_PUBLIC_BASE_URL"] = os.getenv("VIDEO_MAKER_PUBLIC_BASE_URL", "")
    env["REMOTION_ASSET_REWRITE_FROM"] = os.getenv("VIDEO_MAKER_ASSET_REWRITE_FROM", "")
    env["REMOTION_ASSET_REWRITE_TO"] = os.getenv("VIDEO_MAKER_ASSET_REWRITE_TO", "")
    completed = subprocess.run(
        shlex.split(command),
        cwd=Path.cwd(),
        capture_output=True,
        text=True,
        check=False,
        timeout=float(os.getenv("VIDEO_MAKER_REMOTION_TIMEOUT_SECONDS", "1800")),
        env=env,
    )
    if completed.returncode != 0:
        output = "\n".join(part for part in [completed.stderr, completed.stdout] if part).strip()
        detail = output[:8000] if output else f"Remotion command exited {completed.returncode}"
        raise RuntimeError(f"Remotion command failed: {command}\n{detail}")
    if not output_path.exists() or output_path.stat().st_size <= 0:
        raise RuntimeError("Remotion did not create a non-empty MP4 output")


def _oss_storage() -> AliyunOssOutputStorage:
    return AliyunOssOutputStorage(
        endpoint=os.getenv("VIDEO_MAKER_OSS_ENDPOINT", ""),
        bucket=os.getenv("VIDEO_MAKER_OSS_BUCKET", ""),
        access_key_id=os.getenv("VIDEO_MAKER_OSS_ACCESS_KEY_ID", ""),
        access_key_secret=os.getenv("VIDEO_MAKER_OSS_ACCESS_KEY_SECRET", ""),
        prefix=os.getenv("VIDEO_MAKER_OSS_PREFIX", "wedding-videos"),
        public_base_url=os.getenv("VIDEO_MAKER_OSS_PUBLIC_BASE_URL") or None,
        timeout_seconds=float(os.getenv("VIDEO_MAKER_OSS_TIMEOUT_SECONDS", "120")),
    )


def _post_json(url: str | None, payload: dict) -> None:
    if not url:
        return
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 Chrome/126 Safari/537.36"
        ),
    }
    token = os.getenv("VIDEO_MAKER_RENDER_CALLBACK_TOKEN")
    if token:
        headers["X-Render-Callback-Token"] = token
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            status = getattr(response, "status", response.getcode())
            if status >= 300:
                raise RuntimeError(f"Callback {url} failed with HTTP {status}")
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Callback {url} failed with HTTP {exc.code}: {error_body}") from exc


if __name__ == "__main__":
    raise SystemExit(main())
