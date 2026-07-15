from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.mysql import JSON as MySQLJSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import JSON


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


JsonType = JSON().with_variant(MySQLJSON(), "mysql")


class AssetRow(Base):
    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    type: Mapped[str] = mapped_column(String(24), index=True)
    url: Mapped[str] = mapped_column(Text)
    tag: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict] = mapped_column("metadata", JsonType, default=dict)
    analysis_status: Mapped[str] = mapped_column(String(32))
    analysis_json: Mapped[dict] = mapped_column("analysis", JsonType, default=dict)
    payload: Mapped[dict] = mapped_column(JsonType)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class VideoSpecRow(Base):
    __tablename__ = "video_specs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    payload: Mapped[dict] = mapped_column(JsonType)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RenderJobRow(Base):
    __tablename__ = "render_jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    spec_id: Mapped[str] = mapped_column(String(64), index=True)
    project_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    payload: Mapped[dict] = mapped_column(JsonType)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class VideoRenderProjectRow(Base):
    __tablename__ = "video_render_projects"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    spec_id: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    invite_code: Mapped[str] = mapped_column(String(12), unique=True, index=True)
    couple_names: Mapped[str] = mapped_column(String(160))
    wedding_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    location: Mapped[str | None] = mapped_column(String(240), nullable=True)
    package_type: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), index=True)
    entitlement_status: Mapped[str] = mapped_column(String(32), index=True)
    payload: Mapped[dict] = mapped_column(JsonType)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PurchaseEntitlementRow(Base):
    __tablename__ = "purchase_entitlements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    render_project_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("video_render_projects.id"), index=True
    )
    product_id: Mapped[str] = mapped_column(String(160))
    transaction_id: Mapped[str] = mapped_column(String(160), unique=True)
    original_transaction_id: Mapped[str] = mapped_column(String(160), index=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProjectAssetRow(Base):
    __tablename__ = "project_assets"
    __table_args__ = (UniqueConstraint("project_id", "asset_id", name="uq_project_asset"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("video_render_projects.id"), index=True
    )
    asset_id: Mapped[str] = mapped_column(String(64), ForeignKey("assets.id"), index=True)
    source: Mapped[str] = mapped_column(String(32), index=True)
    guest_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
