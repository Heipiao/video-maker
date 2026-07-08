import shutil
from pathlib import Path

from app.core.settings import get_settings
from app.models.project import ExportJob, WeddingProject

MOCK_EXPORT = Path(__file__).resolve().parents[1] / "static" / "mock_export.mp4"


async def render_video(project: WeddingProject, tier: str) -> ExportJob:
    settings = get_settings()
    export_dir = settings.storage_dir / "projects" / project.id / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)

    job = ExportJob(project_id=project.id, tier=tier)
    output_path = export_dir / f"{job.id}.mp4"
    shutil.copyfile(MOCK_EXPORT, output_path)
    job.status = "ready"
    job.output_path = str(output_path)
    job.watermarked = tier == "watermarked_preview"
    job.download_url = f"{settings.public_base_url}/exports/{job.id}/download"
    job.preview_url = job.download_url if job.watermarked else None
    job.export_url = job.download_url if not job.watermarked else None
    job.thumbnail_url = f"{settings.public_base_url}/exports/{job.id}/thumbnail"
    return job
