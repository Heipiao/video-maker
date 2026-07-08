from app.models.render import RenderJob
from app.services.file_store import JsonFileStore, RecordNotFoundError


JobNotFoundError = RecordNotFoundError


class FileJobStore(JsonFileStore[RenderJob]):
    def __init__(self, jobs_dir) -> None:
        super().__init__(jobs_dir, RenderJob)
