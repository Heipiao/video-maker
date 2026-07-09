from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from app.models.render import RenderJob, RenderJobStatus
from app.schemas import CreateRenderJobRequest, RenderJobCallbackRequest, RenderJobHeartbeatRequest
from app.services.eci_launcher import EciConfigError, EciLaunchError, EciLaunchRequest, EciLauncher
from app.services.job_store import FileJobStore
from app.services.output_storage import OutputStorageError
from app.services.renderer import ManifestRenderer, RemotionRenderer
from app.services.spec_store import FileSpecStore


class UnknownRendererError(Exception):
    pass


class RemoteRenderError(Exception):
    pass


class InvalidRenderCallbackError(Exception):
    pass


class RenderService:
    def __init__(
        self,
        job_store: FileJobStore,
        spec_store: FileSpecStore,
        outputs_dir: Path,
        remotion_command: str | None = None,
        remotion_timeout_seconds: float = 300,
        public_base_url: str = "http://127.0.0.1:8017",
        render_callback_base_url: str | None = None,
        output_storage=None,
        cleanup_local_output: bool = False,
        eci_launcher: EciLauncher | None = None,
        eci_max_attempts: int = 3,
        render_callback_token: str | None = None,
    ) -> None:
        self.job_store = job_store
        self.spec_store = spec_store
        self.outputs_dir = outputs_dir
        self.remotion_command = remotion_command
        self.remotion_timeout_seconds = remotion_timeout_seconds
        self.public_base_url = public_base_url
        self.render_callback_base_url = (render_callback_base_url or public_base_url).rstrip("/")
        self.output_storage = output_storage
        self.cleanup_local_output = cleanup_local_output
        self.eci_launcher = eci_launcher
        self.eci_max_attempts = eci_max_attempts
        self.render_callback_token = render_callback_token

    def create_job(self, request: CreateRenderJobRequest) -> RenderJob:
        spec = self.spec_store.get(request.spec_id)
        job = RenderJob(id=str(uuid4()), spec_id=spec.id, renderer=request.renderer)
        self.job_store.save(job)

        if request.renderer != ManifestRenderer.name:
            job.status = RenderJobStatus.failed
            job.error = f"Unknown renderer: {request.renderer}"
            job.touch()
            self.job_store.save(job)
            raise UnknownRendererError(request.renderer)

        job.status = RenderJobStatus.rendering
        job.touch()
        self.job_store.save(job)
        job = ManifestRenderer(self.outputs_dir).render(job, spec)
        # Manifest mode does not produce MP4; the job remains queued for a real worker.
        job.status = RenderJobStatus.queued
        job.touch()
        return self.job_store.save(job)

    def get_job(self, job_id: str) -> RenderJob:
        return self.job_store.get(job_id)

    def render_with_remotion(self, job_id: str) -> RenderJob:
        job = self.job_store.get(job_id)
        spec = self.spec_store.get(job.spec_id)
        job.status = RenderJobStatus.rendering
        job.error = None
        job.touch()
        self.job_store.save(job)
        try:
            job = RemotionRenderer(
                outputs_dir=self.outputs_dir,
                command=self.remotion_command,
                timeout_seconds=self.remotion_timeout_seconds,
                public_base_url=self.public_base_url,
                output_storage=self.output_storage,
                cleanup_local_output=self.cleanup_local_output,
            ).render(job, spec)
            job.status = RenderJobStatus.ready
            job.touch()
            return self.job_store.save(job)
        except Exception as exc:
            job.status = RenderJobStatus.failed
            job.error = str(exc)
            job.touch()
            self.job_store.save(job)
            raise

    def dispatch_to_eci(self, job_id: str) -> RenderJob:
        if self.eci_launcher is None:
            raise RemoteRenderError("ECI renderer is not configured")
        if self.output_storage is None:
            raise RemoteRenderError("OSS output storage is not configured")

        job = self.job_store.get(job_id)
        spec = self.spec_store.get(job.spec_id)
        if job.attempt_count >= max(job.max_attempts, self.eci_max_attempts):
            raise RemoteRenderError("Render job has reached max ECI attempts")

        job.renderer = "eci"
        job.status = RenderJobStatus.provisioning
        job.error = None
        job.attempt_count += 1
        job.max_attempts = self.eci_max_attempts
        job.started_at = job.started_at or datetime.now(timezone.utc)

        worker_spec = self._worker_spec(spec)
        ManifestRenderer(self.outputs_dir).render(job, worker_spec)
        manifest_path = self.manifest_path(job.id)

        manifest_object_key = f"jobs/{job.id}/manifest.json"
        output_object_key = f"jobs/{job.id}/output.mp4"
        try:
            manifest_url = self.output_storage.upload_bytes(
                manifest_path.read_bytes(),
                manifest_object_key,
                "application/json",
            )
        except OutputStorageError as exc:
            job.status = RenderJobStatus.failed
            job.error = str(exc)
            job.touch()
            self.job_store.save(job)
            raise RemoteRenderError(str(exc)) from exc

        job.manifest_oss_url = manifest_url
        job.manifest_oss_key = self.output_storage.normalize_key(manifest_object_key)
        job.output_oss_key = self.output_storage.normalize_key(output_object_key)
        job.touch()
        self.job_store.save(job)

        launch_request = EciLaunchRequest(
            job=job,
            manifest_url=self._manifest_worker_url(job.id, manifest_url),
            manifest_oss_key=job.manifest_oss_key,
            output_oss_key=job.output_oss_key,
            callback_url=self._callback_url(job.id),
            heartbeat_url=self._heartbeat_url(job.id),
            callback_token=self.render_callback_token,
        )
        try:
            result = self.eci_launcher.launch(launch_request)
        except (EciConfigError, EciLaunchError) as exc:
            job.status = RenderJobStatus.failed
            job.error = str(exc)
            job.touch()
            self.job_store.save(job)
            raise RemoteRenderError(str(exc)) from exc

        job.eci_container_group_id = result.container_group_id
        job.status = RenderJobStatus.rendering
        job.touch()
        return self.job_store.save(job)

    def heartbeat(self, job_id: str, request: RenderJobHeartbeatRequest) -> RenderJob:
        job = self.job_store.get(job_id)
        if request.status in {RenderJobStatus.rendering, RenderJobStatus.uploading}:
            job.status = request.status
        job.touch()
        job.heartbeat_at = job.updated_at
        return self.job_store.save(job)

    def apply_callback(self, job_id: str, request: RenderJobCallbackRequest) -> RenderJob:
        job = self.job_store.get(job_id)
        if request.status == RenderJobStatus.ready:
            if not request.output_url:
                raise InvalidRenderCallbackError("output_url is required when status=ready")
            job.status = RenderJobStatus.ready
            job.output_url = request.output_url
            job.output_oss_key = request.output_oss_key or job.output_oss_key
            job.error = None
        elif request.status == RenderJobStatus.failed:
            job.status = RenderJobStatus.failed
            job.error = request.error or "Remote render failed"
        elif request.status == RenderJobStatus.preempted:
            job.status = (
                RenderJobStatus.retrying
                if job.attempt_count < job.max_attempts
                else RenderJobStatus.preempted
            )
            job.error = request.error or "Remote render was preempted"
        else:
            raise InvalidRenderCallbackError(
                "Callback status must be one of ready, failed, or preempted"
            )
        job.touch()
        if request.status in {RenderJobStatus.ready, RenderJobStatus.failed}:
            job.finished_at = job.updated_at
        return self.job_store.save(job)

    def manifest_path(self, job_id: str) -> Path:
        return self.outputs_dir / f"{job_id}.manifest.json"

    def get_manifest(self, job_id: str) -> str:
        return self.manifest_path(job_id).read_text(encoding="utf-8")

    def _callback_url(self, job_id: str) -> str:
        return f"{self.render_callback_base_url}/api/v1/render-jobs/{job_id}/callback"

    def _heartbeat_url(self, job_id: str) -> str:
        return f"{self.render_callback_base_url}/api/v1/render-jobs/{job_id}/heartbeat"

    def _manifest_worker_url(self, job_id: str, fallback_url: str) -> str:
        if self.render_callback_base_url:
            return f"{self.render_callback_base_url}/api/v1/render-jobs/{job_id}/manifest"
        return fallback_url

    def _worker_spec(self, spec):
        worker_spec = spec.model_copy(deep=True)
        worker_spec.assets = [
            asset.__class__.model_validate(
                {**asset.model_dump(mode="json"), "url": self._worker_asset_url(str(asset.url))}
            )
            for asset in worker_spec.assets
        ]
        return worker_spec

    def _worker_asset_url(self, asset_url: str) -> str:
        if not self.public_base_url or not self.render_callback_base_url:
            return asset_url
        source = urlsplit(asset_url)
        public = urlsplit(self.public_base_url)
        target = urlsplit(self.render_callback_base_url)
        if not source.netloc or not public.netloc or not target.netloc:
            return asset_url
        if source.netloc != public.netloc:
            return asset_url
        return urlunsplit((target.scheme, target.netloc, source.path, source.query, source.fragment))
