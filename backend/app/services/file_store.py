from pathlib import Path
from typing import Generic, TypeVar

from pydantic import BaseModel

ModelT = TypeVar("ModelT", bound=BaseModel)


class RecordNotFoundError(Exception):
    pass


class JsonFileStore(Generic[ModelT]):
    def __init__(self, directory: Path, model_type: type[ModelT]) -> None:
        self.directory = directory
        self.model_type = model_type
        self.directory.mkdir(parents=True, exist_ok=True)

    def _path_for(self, record_id: str) -> Path:
        return self.directory / f"{record_id}.json"

    def save(self, record: ModelT) -> ModelT:
        self._path_for(str(record.id)).write_text(record.model_dump_json(indent=2), encoding="utf-8")
        return record

    def get(self, record_id: str) -> ModelT:
        path = self._path_for(record_id)
        if not path.exists():
            raise RecordNotFoundError(record_id)
        return self.model_type.model_validate_json(path.read_text(encoding="utf-8"))
