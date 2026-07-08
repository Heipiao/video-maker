from datetime import UTC, datetime
from enum import StrEnum
from uuid import uuid4

from pydantic import BaseModel, Field


class ProjectStatus(StrEnum):
    draft = "draft"
    story_ready = "story_ready"
    preview_ready = "preview_ready"
    export_ready = "export_ready"


class Asset(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    filename: str
    content_type: str
    path: str


class StoryDraft(BaseModel):
    title: str
    hook: str
    beats: list[str]
    shot_list: list[str] = Field(default_factory=list)
    missing_assets: list[str] = Field(default_factory=list)
    platform_plan: list[str] = Field(default_factory=list)
    edit_notes: list[str] = Field(default_factory=list)
    ending: str


class ExportJob(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    project_id: str
    status: str = "queued"
    tier: str
    output_path: str | None = None
    download_url: str | None = None
    preview_url: str | None = None
    export_url: str | None = None
    thumbnail_url: str | None = None
    watermarked: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class WeddingProject(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    video_type: str
    couple_names: str
    wedding_date: str
    location: str
    style: str = "nostalgic"
    aspect_ratio: str = "9:16"
    template_id: str = "nostalgia_love_story_40"
    music_track_id: str = "nostalgia_soft_pop"
    assets: list[Asset] = Field(default_factory=list)
    story: StoryDraft | None = None
    preview_job_id: str | None = None
    export_job_id: str | None = None
    status: ProjectStatus = ProjectStatus.draft
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    def touch(self) -> None:
        self.updated_at = datetime.now(UTC)
