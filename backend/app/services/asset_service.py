from uuid import uuid4

from app.models.asset import Asset
from app.schemas import CreateAssetRequest
from app.services.asset_store import FileAssetStore


class AssetService:
    def __init__(self, asset_store: FileAssetStore) -> None:
        self.asset_store = asset_store

    def create_asset(self, request: CreateAssetRequest) -> Asset:
        asset = Asset(id=str(uuid4()), **request.model_dump())
        return self.asset_store.save(asset)

    def get_asset(self, asset_id: str) -> Asset:
        return self.asset_store.get(asset_id)
