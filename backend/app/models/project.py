from datetime import datetime, timezone
from enum import StrEnum

from pydantic import BaseModel, Field

from app.models.asset import Asset
from app.models.wedding_project import WeddingAssetSource, WeddingPackageType, WeddingProjectStatus


class EntitlementStatus(StrEnum):
    none = "none"
    active = "active"
    refunded = "refunded"
    revoked = "revoked"


class VideoProject(BaseModel):
    id: str
    spec_id: str | None = None
    invite_code: str = Field(min_length=6, max_length=6)
    couple_names: str = Field(default="Our Wedding", min_length=1, max_length=160)
    wedding_date: str | None = None
    location: str | None = None
    package_type: WeddingPackageType = WeddingPackageType.guest_cam_recap
    status: WeddingProjectStatus = WeddingProjectStatus.active
    owner_id: str | None = None
    preview_job_id: str | None = None
    final_job_id: str | None = None
    entitlement_status: EntitlementStatus = EntitlementStatus.none
    product_id: str | None = None
    transaction_id: str | None = None
    original_transaction_id: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def touch(self) -> None:
        self.updated_at = datetime.now(timezone.utc)


class ProjectAsset(BaseModel):
    asset: Asset
    source: WeddingAssetSource
    guest_name: str | None = None
    note: str | None = None
    created_at: datetime
