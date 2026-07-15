from pathlib import Path

from app.models.render import RenderJob


def project_asset_object_key(project_id: str, filename: str) -> str:
    return f"projects/{project_id}/assets/{Path(filename).name}"


def upload_object_key(filename: str) -> str:
    return f"uploads/{Path(filename).name}"


def render_manifest_object_key(job: RenderJob) -> str:
    if job.project_id:
        return f"projects/{job.project_id}/renders/{job.id}/{job.variant}/manifest.json"
    return f"jobs/{job.id}/manifest.json"


def render_output_object_key(job: RenderJob) -> str:
    if job.project_id:
        return f"projects/{job.project_id}/renders/{job.id}/{job.variant}/output.mp4"
    return f"jobs/{job.id}/output.mp4"
