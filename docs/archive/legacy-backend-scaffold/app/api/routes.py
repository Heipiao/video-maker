from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.models.catalog import MUSIC_TRACKS, TEMPLATES
from app.models.project import Asset, ProjectStatus, WeddingProject
from app.schemas import (
    CreateExportRequest,
    CreateProjectRequest,
    ExportResponse,
    GenerateStoryRequest,
    ProjectResponse,
    ProjectsResponse,
    StoryResponse,
    UpdateSelectionsRequest,
)
from app.services.deepseek_story import generate_story
from app.services.hyperframes_renderer import render_video
from app.services.storage import save_upload
from app.services.store import store

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/templates")
async def templates():
    return {"templates": TEMPLATES}


@router.get("/music-tracks")
async def music_tracks():
    return {"music_tracks": MUSIC_TRACKS}


@router.post("/projects", response_model=ProjectResponse)
async def create_project(payload: CreateProjectRequest) -> ProjectResponse:
    project = WeddingProject(**payload.model_dump())
    store.add_project(project)
    return ProjectResponse(project=project)


@router.get("/projects", response_model=ProjectsResponse)
async def list_projects() -> ProjectsResponse:
    return ProjectsResponse(projects=store.list_projects())


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str) -> ProjectResponse:
    project = store.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return ProjectResponse(project=project)


@router.patch("/projects/{project_id}/selections", response_model=ProjectResponse)
async def update_selections(project_id: str, payload: UpdateSelectionsRequest) -> ProjectResponse:
    project = store.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.template_id = payload.template_id
    project.music_track_id = payload.music_track_id
    project.aspect_ratio = payload.aspect_ratio
    project.touch()
    return ProjectResponse(project=project)


@router.post("/projects/{project_id}/assets", response_model=ProjectResponse)
async def upload_assets(
    project_id: str, files: list[UploadFile] = File(...)
) -> ProjectResponse:
    project = store.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if len(project.assets) + len(files) > 30:
        raise HTTPException(status_code=400, detail="MVP supports up to 30 photos")

    for upload in files:
        if not (upload.content_type or "").startswith("image/"):
            raise HTTPException(status_code=400, detail="Only image uploads are enabled in MVP")
        filename, path = await save_upload(project_id, upload)
        project.assets.append(
            Asset(filename=filename, content_type=upload.content_type or "image/jpeg", path=str(path))
        )
    project.touch()
    return ProjectResponse(project=project)


@router.post("/projects/{project_id}/story", response_model=StoryResponse)
async def create_story(project_id: str, payload: GenerateStoryRequest) -> StoryResponse:
    project = store.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.story = await generate_story(project, payload.tone, payload.notes)
    project.status = ProjectStatus.story_ready
    project.touch()
    return StoryResponse(story=project.story)


@router.post("/projects/{project_id}/preview", response_model=ExportResponse)
async def create_preview(project_id: str) -> ExportResponse:
    project = store.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    job = await render_video(project, "watermarked_preview")
    store.save_job(job)
    project.preview_job_id = job.id
    project.status = ProjectStatus.preview_ready
    project.touch()
    return ExportResponse(job=job)


@router.post("/projects/{project_id}/exports", response_model=ExportResponse)
async def create_export(project_id: str, payload: CreateExportRequest) -> ExportResponse:
    project = store.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    job = await render_video(project, payload.tier)
    store.save_job(job)
    project.export_job_id = job.id
    project.status = ProjectStatus.export_ready
    project.touch()
    return ExportResponse(job=job)


@router.get("/exports/{job_id}/download")
async def download_export(job_id: str) -> FileResponse:
    job = store.get_job(job_id)
    if not job or not job.output_path:
        raise HTTPException(status_code=404, detail="Export not found")
    return FileResponse(job.output_path, filename=f"vowframe-{job_id}.mp4", media_type="video/mp4")


@router.get("/exports/{job_id}/thumbnail")
async def export_thumbnail(job_id: str) -> dict[str, str]:
    job = store.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export not found")
    return {"status": "ready", "thumbnail": "placeholder"}
