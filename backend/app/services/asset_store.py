from app.models.asset import Asset
from app.services.file_store import JsonFileStore, RecordNotFoundError

AssetNotFoundError = RecordNotFoundError


class FileAssetStore(JsonFileStore[Asset]):
    def __init__(self, assets_dir) -> None:
        super().__init__(assets_dir, Asset)
