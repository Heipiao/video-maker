from datetime import datetime, timezone
from enum import StrEnum

from pydantic import BaseModel, Field


class RenderJobStatus(StrEnum):
    queued = "queued"
    provisioning = "provisioning"
    rendering = "rendering"
    uploading = "uploading"
    ready = "ready"
    failed = "failed"
    preempted = "preempted"
    retrying = "retrying"
    expired = "expired"


class RenderVariant(StrEnum):
    preview = "preview"
    final = "final"


class RenderJob(BaseModel):
    id: str
    spec_id: str
    project_id: str | None = None
    variant: RenderVariant = RenderVariant.final
    watermark: bool = False
    resolution: str | None = None
    entitlement_required: bool = False
    renderer: str = "manifest"
    status: RenderJobStatus = RenderJobStatus.queued
    manifest_url: str | None = None
    manifest_oss_url: str | None = None
    manifest_oss_key: str | None = None
    output_url: str | None = None
    output_oss_key: str | None = None
    eci_container_group_id: str | None = None
    attempt_count: int = 0
    max_attempts: int = 1
    error: str | None = None
    heartbeat_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def touch(self) -> None:
        self.updated_at = datetime.now(timezone.utc)
