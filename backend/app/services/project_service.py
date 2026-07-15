import secrets
import string
from uuid import uuid4

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db_models import AssetRow, ProjectAssetRow, VideoRenderProjectRow
from app.models.asset import AssetType
from app.models.project import EntitlementStatus, ProjectAsset, VideoProject
from app.models.render import RenderJob, RenderVariant
from app.models.wedding_project import WeddingAssetSource
from app.schemas import (
    AppleIapRestoreRequest,
    AppleIapVerifyRequest,
    CreateRenderJobRequest,
    CreateVideoProjectRequest,
    LinkProjectAssetRequest,
    UpdateVideoProjectRequest,
)
from app.services.db_store import DbAssetStore
from app.services.db_store import PurchaseEntitlementRepository
from app.services.file_store import RecordNotFoundError
from app.services.job_store import FileJobStore
from app.services.project_store import FileProjectStore
from app.services.render_service import RenderService
from app.services.spec_store import FileSpecStore


class EntitlementRequiredError(Exception):
    pass


class EntitlementRestoreError(Exception):
    pass


class ProjectAssetError(Exception):
    pass


class ProjectSpecRequiredError(Exception):
    pass


class VideoProjectService:
    def __init__(
        self,
        project_store: FileProjectStore,
        spec_store: FileSpecStore,
        job_store: FileJobStore,
        render_service: RenderService,
        asset_store: DbAssetStore,
        session: Session,
        entitlement_repository: PurchaseEntitlementRepository | None = None,
    ) -> None:
        self.project_store = project_store
        self.spec_store = spec_store
        self.job_store = job_store
        self.render_service = render_service
        self.asset_store = asset_store
        self.session = session
        self.entitlement_repository = entitlement_repository

    def create_project(self, request: CreateVideoProjectRequest) -> VideoProject:
        spec_id = self._validated_spec_id(request.spec_id)
        last_error: Exception | None = None
        for _ in range(10):
            project = VideoProject(
                id=str(uuid4()),
                spec_id=spec_id,
                invite_code=self._invite_code(),
                couple_names=request.couple_names,
                wedding_date=request.wedding_date,
                location=request.location,
                package_type=request.package_type,
                owner_id=request.owner_id,
            )
            try:
                return self.project_store.save(project)
            except IntegrityError as exc:
                self.session.rollback()
                last_error = exc
        raise ProjectAssetError("Unable to generate a unique invite code") from last_error

    def get_project(self, project_id: str) -> VideoProject:
        return self.project_store.get(project_id)

    def get_by_invite_code(self, invite_code: str) -> VideoProject:
        row = (
            self.session.query(VideoRenderProjectRow)
            .filter(VideoRenderProjectRow.invite_code == invite_code.upper())
            .one_or_none()
        )
        if row is None:
            raise RecordNotFoundError(invite_code)
        return VideoProject.model_validate(row.payload)

    def update_project(self, project_id: str, request: UpdateVideoProjectRequest) -> VideoProject:
        project = self.project_store.get(project_id)
        if request.spec_id is not None and request.spec_id != project.spec_id:
            project.spec_id = self._validated_spec_id(request.spec_id)
            project.preview_job_id = None
            project.final_job_id = None
        if request.couple_names is not None:
            project.couple_names = request.couple_names
        if request.wedding_date is not None:
            project.wedding_date = request.wedding_date
        if request.location is not None:
            project.location = request.location
        if request.package_type is not None:
            project.package_type = request.package_type
        project.touch()
        return self.project_store.save(project)

    def create_preview_job(self, project_id: str) -> tuple[VideoProject, RenderJob]:
        project = self.project_store.get(project_id)
        if not project.spec_id:
            raise ProjectSpecRequiredError("Project must have a spec before preview render")
        existing = self._existing_job(project.preview_job_id)
        if existing:
            return project, existing

        job = self.render_service.create_job(
            CreateRenderJobRequest(
                spec_id=project.spec_id,
                project_id=project.id,
                variant=RenderVariant.preview,
                watermark=True,
                resolution="720x1280",
                entitlement_required=False,
            )
        )
        project.preview_job_id = job.id
        project.touch()
        return self.project_store.save(project), job

    def create_final_job(self, project_id: str) -> tuple[VideoProject, RenderJob]:
        project = self.project_store.get(project_id)
        if not project.spec_id:
            raise ProjectSpecRequiredError("Project must have a spec before final render")
        if project.entitlement_status != EntitlementStatus.active:
            raise EntitlementRequiredError("Purchase is required before creating final render")

        existing = self._existing_job(project.final_job_id)
        if existing:
            return project, existing

        job = self.render_service.create_job(
            CreateRenderJobRequest(
                spec_id=project.spec_id,
                project_id=project.id,
                variant=RenderVariant.final,
                watermark=False,
                resolution="1080x1920",
                entitlement_required=True,
            )
        )
        project.final_job_id = job.id
        project.touch()
        return self.project_store.save(project), job

    def replace_spec_and_create_preview_job(self, project_id: str, spec_id: str) -> tuple[VideoProject, RenderJob]:
        project = self.project_store.get(project_id)
        if project.entitlement_status != EntitlementStatus.active:
            raise EntitlementRequiredError("Purchase is required before modifying this reel")
        spec = self.spec_store.get(spec_id)
        project.spec_id = spec.id
        project.preview_job_id = None
        project.final_job_id = None
        project.touch()
        self.project_store.save(project)
        return self.create_preview_job(project.id)

    def link_asset(self, project_id: str, request: LinkProjectAssetRequest) -> ProjectAsset:
        project = self.project_store.get(project_id)
        try:
            asset = self.asset_store.get(request.asset_id)
        except RecordNotFoundError as exc:
            raise ProjectAssetError(f"Unknown asset_id: {request.asset_id}") from exc
        if request.source == WeddingAssetSource.guest_upload and asset.type == AssetType.music:
            raise ProjectAssetError("Guest uploads can only be photo or video assets")

        metadata = dict(asset.metadata)
        metadata.update(
            {
                "project_id": project.id,
                "source": request.source.value,
            }
        )
        if request.guest_name:
            metadata["guest_name"] = request.guest_name
        asset.metadata = metadata
        self.asset_store.save(asset)

        existing = (
            self.session.query(ProjectAssetRow)
            .filter(ProjectAssetRow.project_id == project.id)
            .filter(ProjectAssetRow.asset_id == asset.id)
            .one_or_none()
        )
        if existing is None:
            existing = ProjectAssetRow(
                project_id=project.id,
                asset_id=asset.id,
                source=request.source.value,
                guest_name=request.guest_name,
                note=request.note,
            )
            self.session.add(existing)
        else:
            existing.source = request.source.value
            existing.guest_name = request.guest_name
            existing.note = request.note
        self.session.commit()
        return ProjectAsset(
            asset=asset,
            source=request.source,
            guest_name=request.guest_name,
            note=request.note,
            created_at=existing.created_at,
        )

    def list_assets(self, project_id: str) -> list[ProjectAsset]:
        self.project_store.get(project_id)
        rows = (
            self.session.query(ProjectAssetRow)
            .filter(ProjectAssetRow.project_id == project_id)
            .order_by(ProjectAssetRow.created_at.asc())
            .all()
        )
        assets: list[ProjectAsset] = []
        for row in rows:
            asset_row = self.session.get(AssetRow, row.asset_id)
            if asset_row is None:
                continue
            assets.append(
                ProjectAsset(
                    asset=self.asset_store.get(row.asset_id),
                    source=WeddingAssetSource(row.source),
                    guest_name=row.guest_name,
                    note=row.note,
                    created_at=row.created_at,
                )
            )
        return assets

    def unlink_asset(self, project_id: str, asset_id: str) -> None:
        self.project_store.get(project_id)
        row = (
            self.session.query(ProjectAssetRow)
            .filter(ProjectAssetRow.project_id == project_id)
            .filter(ProjectAssetRow.asset_id == asset_id)
            .one_or_none()
        )
        if row is None:
            raise ProjectAssetError(f"Unknown project asset_id: {asset_id}")

        try:
            asset = self.asset_store.get(asset_id)
        except RecordNotFoundError:
            asset = None
        if asset is not None:
            metadata = dict(asset.metadata)
            if metadata.get("project_id") == project_id:
                metadata.pop("project_id", None)
                metadata.pop("source", None)
                metadata.pop("guest_name", None)
                asset.metadata = metadata
                self.asset_store.save(asset)

        self.session.delete(row)
        self.session.commit()

    def record_apple_purchase(self, request: AppleIapVerifyRequest) -> VideoProject:
        project = self.project_store.get(request.project_id)
        if self.entitlement_repository is not None:
            self.entitlement_repository.save_active(request)
        project.entitlement_status = EntitlementStatus.active
        project.product_id = request.product_id
        project.transaction_id = request.transaction_id
        project.original_transaction_id = request.original_transaction_id
        project.touch()
        return self.project_store.save(project)

    def restore_apple_purchase(self, request: AppleIapRestoreRequest) -> VideoProject:
        project = self.project_store.get(request.project_id)
        has_recorded_entitlement = (
            self.entitlement_repository is not None
            and self.entitlement_repository.has_active_original_transaction(
                project.id,
                request.original_transaction_id,
            )
        )
        if project.original_transaction_id != request.original_transaction_id and not has_recorded_entitlement:
            raise EntitlementRestoreError("No matching purchase found for this project")
        project.entitlement_status = EntitlementStatus.active
        project.touch()
        return self.project_store.save(project)

    def _existing_job(self, job_id: str | None) -> RenderJob | None:
        if not job_id:
            return None
        try:
            return self.job_store.get(job_id)
        except RecordNotFoundError:
            return None

    def _validated_spec_id(self, spec_id: str | None) -> str | None:
        if spec_id is None:
            return None
        return self.spec_store.get(spec_id).id

    def _invite_code(self) -> str:
        alphabet = string.ascii_uppercase + string.digits
        return "".join(secrets.choice(alphabet) for _ in range(6))
