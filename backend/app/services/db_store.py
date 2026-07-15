from typing import Generic, TypeVar

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db_models import (
    AssetRow,
    PurchaseEntitlementRow,
    RenderJobRow,
    VideoRenderProjectRow,
    VideoSpecRow,
)
from app.models.asset import Asset
from app.models.project import EntitlementStatus, VideoProject
from app.models.render import RenderJob
from app.models.spec import WeddingVideoSpec
from app.schemas import AppleIapVerifyRequest
from app.services.file_store import RecordNotFoundError

ModelT = TypeVar("ModelT", bound=BaseModel)


class JsonPayloadStore(Generic[ModelT]):
    def __init__(self, session: Session, row_type, model_type: type[ModelT]) -> None:
        self.session = session
        self.row_type = row_type
        self.model_type = model_type

    def save(self, record: ModelT) -> ModelT:
        payload = record.model_dump(mode="json")
        row = self.session.get(self.row_type, str(record.id))
        if row is None:
            row = self.row_type(id=str(record.id), payload=payload)
            self.session.add(row)
        else:
            row.payload = payload
        self._patch_columns(row, record)
        self.session.commit()
        return record

    def get(self, record_id: str) -> ModelT:
        row = self.session.get(self.row_type, record_id)
        if row is None:
            raise RecordNotFoundError(record_id)
        return self.model_type.model_validate(row.payload)

    def _patch_columns(self, row, record: ModelT) -> None:
        return None


class DbAssetStore(JsonPayloadStore[Asset]):
    def __init__(self, session: Session) -> None:
        super().__init__(session, AssetRow, Asset)

    def _patch_columns(self, row: AssetRow, record: Asset) -> None:
        row.type = record.type.value
        row.url = str(record.url)
        row.tag = record.tag
        row.description = record.description
        row.caption = record.caption
        row.metadata_json = record.metadata
        row.analysis_status = record.analysis_status.value
        row.analysis_json = record.analysis.model_dump(mode="json")


class DbSpecStore(JsonPayloadStore[WeddingVideoSpec]):
    def __init__(self, session: Session) -> None:
        super().__init__(session, VideoSpecRow, WeddingVideoSpec)


class DbJobStore(JsonPayloadStore[RenderJob]):
    def __init__(self, session: Session) -> None:
        super().__init__(session, RenderJobRow, RenderJob)

    def _patch_columns(self, row: RenderJobRow, record: RenderJob) -> None:
        row.spec_id = record.spec_id
        row.project_id = record.project_id
        row.status = record.status.value


class DbProjectStore(JsonPayloadStore[VideoProject]):
    def __init__(self, session: Session) -> None:
        super().__init__(session, VideoRenderProjectRow, VideoProject)

    def _patch_columns(self, row: VideoRenderProjectRow, record: VideoProject) -> None:
        row.spec_id = record.spec_id
        row.invite_code = record.invite_code
        row.couple_names = record.couple_names
        row.wedding_date = record.wedding_date
        row.location = record.location
        row.package_type = record.package_type.value
        row.status = record.status.value
        row.entitlement_status = record.entitlement_status.value


class PurchaseEntitlementRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def save_active(self, request: AppleIapVerifyRequest) -> None:
        row = (
            self.session.query(PurchaseEntitlementRow)
            .filter(PurchaseEntitlementRow.transaction_id == request.transaction_id)
            .one_or_none()
        )
        if row is None:
            row = PurchaseEntitlementRow(
                render_project_id=request.project_id,
                product_id=request.product_id,
                transaction_id=request.transaction_id,
                original_transaction_id=request.original_transaction_id,
                status=EntitlementStatus.active.value,
            )
            self.session.add(row)
        else:
            row.status = EntitlementStatus.active.value
        self.session.commit()

    def has_active_original_transaction(self, project_id: str, original_transaction_id: str) -> bool:
        return (
            self.session.query(PurchaseEntitlementRow)
            .filter(PurchaseEntitlementRow.render_project_id == project_id)
            .filter(PurchaseEntitlementRow.original_transaction_id == original_transaction_id)
            .filter(PurchaseEntitlementRow.status == EntitlementStatus.active.value)
            .first()
            is not None
        )
