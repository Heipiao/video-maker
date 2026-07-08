from pydantic import BaseModel, Field

from app.models.project import ExportJob, StoryDraft, WeddingProject


class CreateProjectRequest(BaseModel):
    video_type: str = Field(..., examples=["nostalgia_love_story"])
    couple_names: str = Field(..., examples=["Emma & Noah"])
    wedding_date: str = Field(..., examples=["2026-09-12"])
    location: str = Field(..., examples=["Napa Valley, CA"])
    style: str = "nostalgic"
    aspect_ratio: str = "9:16"


class UpdateSelectionsRequest(BaseModel):
    template_id: str
    music_track_id: str
    aspect_ratio: str = "9:16"


class GenerateStoryRequest(BaseModel):
    tone: str = "warm, elegant, modern"
    notes: str = ""


class CreateExportRequest(BaseModel):
    tier: str = Field("hd_1080p", examples=["watermarked_preview", "hd_1080p", "slideshow_60s"])


class ProjectResponse(BaseModel):
    project: WeddingProject


class ProjectsResponse(BaseModel):
    projects: list[WeddingProject]


class StoryResponse(BaseModel):
    story: StoryDraft


class ExportResponse(BaseModel):
    job: ExportJob
