from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.core.settings import get_settings
from app.services.demo_asset_catalog import demo_assets_dir


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Video Maker API", version="0.1.0")
    app.include_router(router)
    app.mount("/static", StaticFiles(directory="app/static"), name="static")
    app.mount("/uploads", StaticFiles(directory=settings.uploads_dir), name="uploads")
    app.mount("/outputs", StaticFiles(directory=settings.outputs_dir), name="outputs")
    app.mount("/demo-assets", StaticFiles(directory=demo_assets_dir()), name="demo-assets")

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse("app/static/index.html")

    return app


app = create_app()
