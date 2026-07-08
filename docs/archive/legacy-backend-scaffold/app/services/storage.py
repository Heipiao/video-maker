from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile

from app.core.settings import get_settings


async def save_upload(project_id: str, upload: UploadFile) -> tuple[str, Path]:
    settings = get_settings()
    project_dir = settings.storage_dir / "projects" / project_id / "assets"
    project_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(upload.filename or "asset").name
    path = project_dir / f"{uuid4()}-{safe_name}"
    with path.open("wb") as out:
        while chunk := await upload.read(1024 * 1024):
            out.write(chunk)
    return safe_name, path
