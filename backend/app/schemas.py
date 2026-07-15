from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, HttpUrl

from app.models.asset import Asset, AssetAnalysis, AssetAnalysisStatus, AssetType
from app.models.agent import AgentRun, AgentSession
from app.models.catalog import Template
from app.models.project import ProjectAsset, VideoProject
from app.models.render import RenderJob, RenderJobStatus, RenderVariant
from app.models.spec import AspectRatio, WeddingVideoSpec
from app.models.wedding_project import WeddingAssetSource, WeddingPackageType

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


class UpdateAssetRequest(BaseModel):
    tag: str | None = Field(default=None, min_length=1)
    description: str | None = None
    caption: str | None = None
    metadata: dict[str, Any] | None = None
    analysis_status: AssetAnalysisStatus | None = None
    analysis: AssetAnalysis | None = None


class AssetResponse(BaseModel):
    asset: Asset


class AssetListResponse(BaseModel):
    assets: list[Asset]


class UploadResponse(BaseModel):
    url: str
    filename: str
    content_type: str
    size_bytes: int
    suggested_asset_type: AssetType
    oss_key: str | None = None


class GenerateVideoSpecRequest(BaseModel):
    template_id: str = Field(min_length=1)
    title: str = Field(min_length=1, max_length=120)
    asset_ids: list[str] = Field(min_length=1, max_length=200)
    aspect_ratio: AspectRatio = AspectRatio.landscape
    style_preset_id: str = Field(default="nostalgia_editorial", min_length=1, max_length=64)


class SaveVideoSpecRequest(BaseModel):
    spec: WeddingVideoSpec


class VideoSpecResponse(BaseModel):
    spec: WeddingVideoSpec


class CreateRenderJobRequest(BaseModel):
    spec_id: str = Field(min_length=1)
    renderer: str = Field(default="manifest", min_length=1)
    project_id: str | None = None
    variant: RenderVariant = RenderVariant.final
    watermark: bool = False
    resolution: str | None = None
    entitlement_required: bool = False


class RenderJobResponse(BaseModel):
    job: RenderJob


class RenderJobPlaybackUrlResponse(BaseModel):
    url: str
    expires_at: datetime


class CreateVideoProjectRequest(BaseModel):
    spec_id: str | None = Field(default=None, min_length=1)
    owner_id: str | None = None
    couple_names: str = Field(default="Our Wedding", min_length=1, max_length=160)
    wedding_date: str | None = None
    location: str | None = None
    package_type: WeddingPackageType = WeddingPackageType.guest_cam_recap


class VideoProjectResponse(BaseModel):
    project: VideoProject


class UpdateVideoProjectRequest(BaseModel):
    spec_id: str | None = Field(default=None, min_length=1)
    couple_names: str | None = Field(default=None, min_length=1, max_length=160)
    wedding_date: str | None = None
    location: str | None = None
    package_type: WeddingPackageType | None = None


class ProjectRenderJobResponse(BaseModel):
    project: VideoProject
    job: RenderJob


class ModifyVideoProjectRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=1000)


class ModifyVideoProjectResponse(BaseModel):
    project: VideoProject
    spec: WeddingVideoSpec
    job: RenderJob


class AppleIapVerifyRequest(BaseModel):
    project_id: str = Field(min_length=1)
    product_id: str = Field(min_length=1, pattern="^(com\\.aigcteacher\\.vowframeapp\\.singleexport|com\\.aigcteacher\\.vowframeapp\\.exportpack)$")
    transaction_id: str = Field(min_length=1)
    original_transaction_id: str = Field(min_length=1)


class AppleIapRestoreRequest(BaseModel):
    project_id: str = Field(min_length=1)
    original_transaction_id: str = Field(min_length=1)


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


class LinkProjectAssetRequest(BaseModel):
    asset_id: str = Field(min_length=1)
    source: WeddingAssetSource = WeddingAssetSource.owner_upload
    guest_name: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=1000)


class ProjectAssetResponse(BaseModel):
    item: ProjectAsset


class ProjectAssetListResponse(BaseModel):
    items: list[ProjectAsset]
