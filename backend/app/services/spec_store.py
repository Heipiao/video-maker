from app.models.spec import WeddingVideoSpec
from app.services.file_store import JsonFileStore, RecordNotFoundError

SpecNotFoundError = RecordNotFoundError


class FileSpecStore(JsonFileStore[WeddingVideoSpec]):
    def __init__(self, specs_dir) -> None:
        super().__init__(specs_dir, WeddingVideoSpec)
