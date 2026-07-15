from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.core.settings import get_settings
from app.db import create_schema
from app.services.demo_asset_catalog import demo_assets_dir


def create_app() -> FastAPI:
    settings = get_settings()
    create_schema(settings)
    app_dir = Path(__file__).resolve().parent
    static_dir = app_dir / "static"
    app = FastAPI(title="Video Maker API", version="0.1.0")
    app.include_router(router)
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
    app.mount("/uploads", StaticFiles(directory=settings.uploads_dir), name="uploads")
    app.mount("/outputs", StaticFiles(directory=settings.outputs_dir), name="outputs")
    demo_dir = demo_assets_dir()
    if demo_dir.exists():
        app.mount("/demo-assets", StaticFiles(directory=demo_dir), name="demo-assets")

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(static_dir / "index.html")

    return app


app = create_app()
