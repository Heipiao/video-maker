from app.models.project import VideoProject
from app.services.file_store import JsonFileStore, RecordNotFoundError


ProjectNotFoundError = RecordNotFoundError


class FileProjectStore(JsonFileStore[VideoProject]):
    def __init__(self, projects_dir) -> None:
        super().__init__(projects_dir, VideoProject)
