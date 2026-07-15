"""initial rds schema

Revision ID: 20260710_0001
Revises:
Create Date: 2026-07-10
"""

from alembic import op
import sqlalchemy as sa

revision = "20260710_0001"
down_revision = None
branch_labels = None
depends_on = None


json_type = sa.JSON()


def upgrade() -> None:
    op.create_table(
        "assets",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("type", sa.String(length=24), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("tag", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("caption", sa.Text(), nullable=True),
        sa.Column("metadata", json_type, nullable=False),
        sa.Column("analysis_status", sa.String(length=32), nullable=False),
        sa.Column("analysis", json_type, nullable=False),
        sa.Column("payload", json_type, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_assets_type", "assets", ["type"])

    op.create_table(
        "video_specs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("payload", json_type, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "video_render_projects",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("spec_id", sa.String(length=64), nullable=True),
        sa.Column("invite_code", sa.String(length=12), nullable=False, unique=True),
        sa.Column("couple_names", sa.String(length=160), nullable=False),
        sa.Column("wedding_date", sa.String(length=32), nullable=True),
        sa.Column("location", sa.String(length=240), nullable=True),
        sa.Column("package_type", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("entitlement_status", sa.String(length=32), nullable=False),
        sa.Column("payload", json_type, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_video_render_projects_spec_id", "video_render_projects", ["spec_id"])
    op.create_index("ix_video_render_projects_invite_code", "video_render_projects", ["invite_code"])
    op.create_index("ix_video_render_projects_status", "video_render_projects", ["status"])
    op.create_index(
        "ix_video_render_projects_entitlement_status",
        "video_render_projects",
        ["entitlement_status"],
    )

    op.create_table(
        "render_jobs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("spec_id", sa.String(length=64), nullable=False),
        sa.Column("project_id", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("payload", json_type, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_render_jobs_spec_id", "render_jobs", ["spec_id"])
    op.create_index("ix_render_jobs_project_id", "render_jobs", ["project_id"])
    op.create_index("ix_render_jobs_status", "render_jobs", ["status"])

    op.create_table(
        "purchase_entitlements",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("render_project_id", sa.String(length=64), nullable=False),
        sa.Column("product_id", sa.String(length=160), nullable=False),
        sa.Column("transaction_id", sa.String(length=160), nullable=False, unique=True),
        sa.Column("original_transaction_id", sa.String(length=160), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["render_project_id"], ["video_render_projects.id"]),
    )
    op.create_index(
        "ix_purchase_entitlements_render_project_id",
        "purchase_entitlements",
        ["render_project_id"],
    )
    op.create_index(
        "ix_purchase_entitlements_original_transaction_id",
        "purchase_entitlements",
        ["original_transaction_id"],
    )
    op.create_index("ix_purchase_entitlements_status", "purchase_entitlements", ["status"])

    op.create_table(
        "project_assets",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("project_id", sa.String(length=64), nullable=False),
        sa.Column("asset_id", sa.String(length=64), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("guest_name", sa.String(length=120), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["video_render_projects.id"]),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"]),
        sa.UniqueConstraint("project_id", "asset_id", name="uq_project_asset"),
    )
    op.create_index(
        "ix_project_assets_project_id",
        "project_assets",
        ["project_id"],
    )
    op.create_index("ix_project_assets_asset_id", "project_assets", ["asset_id"])
    op.create_index("ix_project_assets_source", "project_assets", ["source"])


def downgrade() -> None:
    op.drop_table("project_assets")
    op.drop_table("purchase_entitlements")
    op.drop_table("render_jobs")
    op.drop_table("video_render_projects")
    op.drop_table("video_specs")
    op.drop_table("assets")
