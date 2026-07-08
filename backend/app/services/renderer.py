import json
import shlex
import os
import subprocess
from pathlib import Path

from app.models.render import RenderJob
from app.models.spec import WeddingVideoSpec
from app.services.output_storage import LocalOutputStorage, OutputStorageError


class Renderer:
    name = "base"

    def render(self, job: RenderJob, spec: WeddingVideoSpec) -> RenderJob:
        raise NotImplementedError


class ManifestRenderer(Renderer):
    name = "manifest"

    def __init__(self, outputs_dir: Path) -> None:
        self.outputs_dir = outputs_dir
        self.outputs_dir.mkdir(parents=True, exist_ok=True)

    def manifest_path(self, job_id: str) -> Path:
        return self.outputs_dir / f"{job_id}.manifest.json"

    def render(self, job: RenderJob, spec: WeddingVideoSpec) -> RenderJob:
        manifest = {
            "job_id": job.id,
            "spec": spec.model_dump(mode="json"),
            "renderer": {
                "name": self.name,
                "status": "manifest_only",
                "contract": "This manifest is ready for a Remotion, HyperFrames, FFmpeg, or ECI worker.",
            },
        }
        self.manifest_path(job.id).write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        job.manifest_url = f"/api/v1/render-jobs/{job.id}/manifest"
        job.output_url = None
        return job


class RemotionRenderer(Renderer):
    name = "remotion"

    def __init__(
        self,
        outputs_dir: Path,
        command: str | None,
        timeout_seconds: float = 300,
        public_base_url: str = "http://127.0.0.1:8017",
        output_storage=None,
        cleanup_local_output: bool = False,
    ) -> None:
        self.outputs_dir = outputs_dir
        self.command = command
        self.timeout_seconds = timeout_seconds
        self.public_base_url = public_base_url.rstrip("/")
        self.output_storage = output_storage or LocalOutputStorage()
        self.cleanup_local_output = cleanup_local_output
        self.outputs_dir.mkdir(parents=True, exist_ok=True)

    def manifest_path(self, job_id: str) -> Path:
        return self.outputs_dir / f"{job_id}.manifest.json"

    def output_path(self, job_id: str) -> Path:
        return self.outputs_dir / f"{job_id}.mp4"

    def render(self, job: RenderJob, spec: WeddingVideoSpec) -> RenderJob:
        if not self.command:
            raise RemotionRendererError(
                "VIDEO_MAKER_REMOTION_COMMAND is not configured. "
                "Set it to a command that accepts {manifest_path}, {output_path}, and {job_id}."
            )

        manifest_path = self.manifest_path(job.id)
        if not manifest_path.exists():
            ManifestRenderer(self.outputs_dir).render(job, spec)

        output_path = self.output_path(job.id)
        command = self.command.format(
            manifest_path=str(manifest_path),
            output_path=str(output_path),
            job_id=job.id,
            spec_id=spec.id,
        )
        env = os.environ.copy()
        env["REMOTION_PUBLIC_BASE_URL"] = self.public_base_url
        completed = subprocess.run(
            shlex.split(command),
            cwd=Path.cwd(),
            capture_output=True,
            text=True,
            timeout=self.timeout_seconds,
            check=False,
            env=env,
        )
        if completed.returncode != 0:
            stderr = (completed.stderr or completed.stdout or "").strip()
            raise RemotionRendererError(stderr[:2000] or f"Remotion command exited {completed.returncode}")
        if not output_path.exists():
            raise RemotionRendererError(f"Remotion command completed but did not create {output_path}")
        if output_path.stat().st_size <= 0:
            raise RemotionRendererError(f"Remotion command created an empty output file: {output_path}")

        job.renderer = self.name
        object_key = f"{job.id}.mp4"
        try:
            job.output_url = self.output_storage.upload(output_path, object_key)
        except OutputStorageError as exc:
            raise RemotionRendererError(str(exc)) from exc
        if self.cleanup_local_output and job.output_url and not job.output_url.startswith("/outputs/"):
            output_path.unlink(missing_ok=True)
        return job


class RemotionRendererError(Exception):
    pass
