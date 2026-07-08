from typing import Any

from pydantic import BaseModel, Field, HttpUrl

from app.models.asset import Asset, AssetAnalysis, AssetAnalysisStatus, AssetType
from app.models.agent import AgentRun, AgentSession
from app.models.catalog import Template
from app.models.render import RenderJob, RenderJobStatus
from app.models.spec import AspectRatio, WeddingVideoSpec


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "video-maker"


class TemplateListResponse(BaseModel):
    templates: list[Template]


class CreateAssetRequest(BaseModel):
    type: AssetType
    url: HttpUrl
    tag: str = Field(min_length=1)
    description: str | None = None
    caption: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    analysis_status: AssetAnalysisStatus = AssetAnalysisStatus.pending
    analysis: AssetAnalysis = Field(default_factory=AssetAnalysis)


class AssetResponse(BaseModel):
    asset: Asset


class UploadResponse(BaseModel):
    url: str
    filename: str
    content_type: str
    size_bytes: int
    suggested_asset_type: AssetType


class GenerateVideoSpecRequest(BaseModel):
    template_id: str = Field(min_length=1)
    title: str = Field(min_length=1, max_length=120)
    asset_ids: list[str] = Field(min_length=1, max_length=200)
    aspect_ratio: AspectRatio = AspectRatio.landscape


class SaveVideoSpecRequest(BaseModel):
    spec: WeddingVideoSpec


class VideoSpecResponse(BaseModel):
    spec: WeddingVideoSpec


class CreateRenderJobRequest(BaseModel):
    spec_id: str = Field(min_length=1)
    renderer: str = Field(default="manifest", min_length=1)


class RenderJobResponse(BaseModel):
    job: RenderJob


class RenderJobCallbackRequest(BaseModel):
    status: RenderJobStatus
    output_url: str | None = None
    output_oss_key: str | None = None
    error: str | None = None


class RenderJobHeartbeatRequest(BaseModel):
    status: RenderJobStatus = RenderJobStatus.rendering
    message: str | None = None


class AdvisorOptionsRequest(BaseModel):
    couple_names: str = Field(min_length=1, max_length=120)
    wedding_date: str | None = None
    location: str | None = None
    asset_ids: list[str] = Field(default_factory=list, max_length=200)


class AdvisorOption(BaseModel):
    id: str
    title: str
    description: str
    template_id: str
    aspect_ratio: AspectRatio = AspectRatio.portrait
    primary_color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    photo_motion: str
    transition: str
    music_volume: float = Field(ge=0, le=1)
    prompt: str
    highlights: list[str] = Field(default_factory=list)


class AdvisorOptionsResponse(BaseModel):
    options: list[AdvisorOption]


class CreateAgentSessionRequest(BaseModel):
    system_prompt: str = Field(min_length=1)
    asset_ids: list[str] = Field(default_factory=list, max_length=200)


class AgentSessionResponse(BaseModel):
    session: AgentSession


class SendAgentMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class AgentRunResponse(BaseModel):
    session: AgentSession
    run: AgentRun
