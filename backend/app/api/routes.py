from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status

from app.core.settings import Settings, get_settings
from app.models.catalog import TEMPLATES
from app.schemas import (
    AssetResponse,
    AgentRunResponse,
    AgentSessionResponse,
    AdvisorOptionsRequest,
    AdvisorOptionsResponse,
    CreateAssetRequest,
    CreateAgentSessionRequest,
    CreateRenderJobRequest,
    GenerateVideoSpecRequest,
    HealthResponse,
    RenderJobCallbackRequest,
    RenderJobHeartbeatRequest,
    RenderJobResponse,
    SaveVideoSpecRequest,
    SendAgentMessageRequest,
    TemplateListResponse,
    UploadResponse,
    VideoSpecResponse,
)
from app.services.agent_service import AgentService
from app.services.agent_llm import DeepSeekLLMProvider, MockLLMProvider
from app.services.agent_store import (
    AgentSessionNotFoundError,
    FileAgentRunStore,
    FileAgentSessionStore,
)
from app.services.agent_tool import GenerateVideoTool
from app.services.advisor_service import AdvisorService
from app.services.asset_service import AssetService
from app.services.asset_store import AssetNotFoundError, FileAssetStore
from app.services.demo_asset_catalog import list_demo_assets
from app.services.eci_launcher import EciLauncher
from app.services.file_store import RecordNotFoundError
from app.services.job_store import FileJobStore, JobNotFoundError
from app.services.output_storage import AliyunOssOutputStorage
from app.services.render_service import (
    InvalidRenderModeError,
    InvalidRenderCallbackError,
    RemoteRenderError,
    RenderService,
    UnknownRendererError,
)
from app.services.renderer import RemotionRendererError
from app.services.spec_service import SpecValidationError, VideoSpecService
from app.services.spec_store import FileSpecStore, SpecNotFoundError
from app.services.template_service import (
    TemplateService,
    TemplateValidationError,
    UnknownTemplateError,
)

router = APIRouter()


def get_asset_store(settings: Settings = Depends(get_settings)) -> FileAssetStore:
    return FileAssetStore(settings.assets_dir)


def get_spec_store(settings: Settings = Depends(get_settings)) -> FileSpecStore:
    return FileSpecStore(settings.specs_dir)


def get_template_service() -> TemplateService:
    return TemplateService()


def get_asset_service(asset_store: FileAssetStore = Depends(get_asset_store)) -> AssetService:
    return AssetService(asset_store)


def get_advisor_service(asset_store: FileAssetStore = Depends(get_asset_store)) -> AdvisorService:
    return AdvisorService(asset_store)


def get_llm_provider(settings: Settings = Depends(get_settings)):
    if settings.agent_llm_provider.lower() == "mock":
        return MockLLMProvider()
    return DeepSeekLLMProvider(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
        model=settings.deepseek_model,
        timeout_seconds=settings.deepseek_timeout_seconds,
    )


def get_spec_service(
    asset_store: FileAssetStore = Depends(get_asset_store),
    spec_store: FileSpecStore = Depends(get_spec_store),
    template_service: TemplateService = Depends(get_template_service),
) -> VideoSpecService:
    return VideoSpecService(asset_store, spec_store, template_service)


def get_render_service(
    settings: Settings = Depends(get_settings),
    spec_store: FileSpecStore = Depends(get_spec_store),
) -> RenderService:
    output_storage = (
        AliyunOssOutputStorage(
            endpoint=settings.oss_endpoint or "",
            bucket=settings.oss_bucket or "",
            access_key_id=settings.oss_access_key_id or "",
            access_key_secret=settings.oss_access_key_secret or "",
            prefix=settings.oss_prefix,
            public_base_url=settings.oss_public_base_url,
            timeout_seconds=settings.oss_timeout_seconds,
        )
        if settings.oss_enabled
        else None
    )
    return RenderService(
        FileJobStore(settings.jobs_dir),
        spec_store,
        settings.outputs_dir,
        remotion_command=settings.remotion_command,
        remotion_timeout_seconds=settings.remotion_timeout_seconds,
        public_base_url=settings.public_base_url,
        render_callback_base_url=settings.render_callback_base_url,
        output_storage=output_storage,
        cleanup_local_output=settings.oss_enabled and settings.oss_cleanup_local_output,
        eci_launcher=EciLauncher(settings),
        eci_max_attempts=settings.eci_max_attempts,
        render_callback_token=settings.render_callback_token,
    )


def _suggest_asset_type(content_type: str, filename: str):
    content_type = (content_type or "").lower()
    suffix = Path(filename).suffix.lower()
    if content_type.startswith("image/") or suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return "photo"
    if content_type.startswith("video/") or suffix in {".mp4", ".mov", ".webm", ".m4v"}:
        return "video"
    if content_type.startswith("audio/") or suffix in {".mp3", ".wav", ".m4a", ".aac", ".ogg"}:
        return "music"
    return "photo"


@router.post("/api/v1/uploads", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
) -> UploadResponse:
    original_name = Path(file.filename or "upload").name
    suffix = Path(original_name).suffix
    stored_name = f"{uuid4()}{suffix}"
    target = settings.uploads_dir / stored_name
    content = await file.read()
    target.write_bytes(content)
    content_type = file.content_type or "application/octet-stream"
    return UploadResponse(
        url=str(request.url_for("uploads", path=stored_name)),
        filename=original_name,
        content_type=content_type,
        size_bytes=len(content),
        suggested_asset_type=_suggest_asset_type(content_type, original_name),
    )


def get_agent_service(
    settings: Settings = Depends(get_settings),
    asset_store: FileAssetStore = Depends(get_asset_store),
    spec_store: FileSpecStore = Depends(get_spec_store),
    spec_service: VideoSpecService = Depends(get_spec_service),
    render_service: RenderService = Depends(get_render_service),
    llm_provider=Depends(get_llm_provider),
) -> AgentService:
    generate_video_tool = GenerateVideoTool(
        spec_service=spec_service,
        render_service=render_service,
        global_render_path_template=settings.global_render_path,
    )
    return AgentService(
        session_store=FileAgentSessionStore(settings.agent_sessions_dir),
        run_store=FileAgentRunStore(settings.agent_runs_dir),
        asset_store=asset_store,
        spec_store=spec_store,
        generate_video_tool=generate_video_tool,
        llm_provider=llm_provider,
    )


@router.get("/health", response_model=HealthResponse)
@router.get("/api/v1/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@router.get("/api/v1/templates", response_model=TemplateListResponse)
def list_templates() -> TemplateListResponse:
    return TemplateListResponse(templates=list(TEMPLATES))


@router.get("/api/v1/demo-assets")
def list_builtin_demo_assets() -> dict[str, list[dict]]:
    return {"assets": list_demo_assets()}


@router.post("/api/v1/advisor/options", response_model=AdvisorOptionsResponse)
def create_advisor_options(
    request: AdvisorOptionsRequest,
    advisor_service: AdvisorService = Depends(get_advisor_service),
) -> AdvisorOptionsResponse:
    try:
        return AdvisorOptionsResponse(options=advisor_service.generate_options(request))
    except RecordNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown asset_id: {exc}",
        ) from exc


@router.post("/api/v1/assets", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
def create_asset(
    request: CreateAssetRequest,
    asset_service: AssetService = Depends(get_asset_service),
) -> AssetResponse:
    return AssetResponse(asset=asset_service.create_asset(request))


@router.get("/api/v1/assets/{asset_id}", response_model=AssetResponse)
def get_asset(
    asset_id: str,
    asset_service: AssetService = Depends(get_asset_service),
) -> AssetResponse:
    try:
        return AssetResponse(asset=asset_service.get_asset(asset_id))
    except AssetNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found") from exc


@router.post("/api/v1/video-specs/generate", response_model=VideoSpecResponse)
def generate_video_spec(
    request: GenerateVideoSpecRequest,
    spec_service: VideoSpecService = Depends(get_spec_service),
    llm_provider=Depends(get_llm_provider),
) -> VideoSpecResponse:
    try:
        return VideoSpecResponse(spec=spec_service.generate_spec(request, llm_provider))
    except UnknownTemplateError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown template_id: {exc}",
        ) from exc
    except RecordNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown asset_id: {exc}",
        ) from exc
    except SpecValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.put("/api/v1/video-specs/{spec_id}", response_model=VideoSpecResponse)
def save_video_spec(
    spec_id: str,
    request: SaveVideoSpecRequest,
    spec_service: VideoSpecService = Depends(get_spec_service),
) -> VideoSpecResponse:
    if spec_id != request.spec.id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Path spec_id must match body spec.id",
        )
    try:
        return VideoSpecResponse(spec=spec_service.save_spec(request.spec))
    except UnknownTemplateError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown template_id: {exc}",
        ) from exc
    except TemplateValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.get("/api/v1/video-specs/{spec_id}", response_model=VideoSpecResponse)
def get_video_spec(
    spec_id: str,
    spec_service: VideoSpecService = Depends(get_spec_service),
) -> VideoSpecResponse:
    try:
        return VideoSpecResponse(spec=spec_service.get_spec(spec_id))
    except SpecNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video spec not found") from exc


@router.post(
    "/api/v1/render-jobs",
    response_model=RenderJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_render_job(
    request: CreateRenderJobRequest,
    render_service: RenderService = Depends(get_render_service),
) -> RenderJobResponse:
    try:
        return RenderJobResponse(job=render_service.create_job(request))
    except SpecNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown spec_id: {exc}",
        ) from exc
    except UnknownRendererError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown renderer: {exc}",
        ) from exc


@router.get("/api/v1/render-jobs/{job_id}", response_model=RenderJobResponse)
def get_render_job(
    job_id: str,
    render_service: RenderService = Depends(get_render_service),
) -> RenderJobResponse:
    try:
        return RenderJobResponse(job=render_service.get_job(job_id))
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc


@router.post("/api/v1/render-jobs/{job_id}/remotion", response_model=RenderJobResponse)
def render_job_with_remotion(
    job_id: str,
    render_service: RenderService = Depends(get_render_service),
) -> RenderJobResponse:
    try:
        return RenderJobResponse(job=render_service.render_with_remotion(job_id))
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc
    except SpecNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video spec not found") from exc
    except RemotionRendererError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.post("/api/v1/render-jobs/{job_id}/start", response_model=RenderJobResponse)
def start_render_job(
    job_id: str,
    settings: Settings = Depends(get_settings),
    render_service: RenderService = Depends(get_render_service),
) -> RenderJobResponse:
    try:
        return RenderJobResponse(job=render_service.start_render(job_id, settings.render_mode))
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc
    except SpecNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video spec not found") from exc
    except (InvalidRenderModeError, RemoteRenderError, RemotionRendererError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.post("/api/v1/render-jobs/{job_id}/eci", response_model=RenderJobResponse)
def render_job_with_eci(
    job_id: str,
    render_service: RenderService = Depends(get_render_service),
) -> RenderJobResponse:
    try:
        return RenderJobResponse(job=render_service.dispatch_to_eci(job_id))
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc
    except SpecNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video spec not found") from exc
    except RemoteRenderError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


def _validate_callback_token(request: Request, settings: Settings) -> None:
    if not settings.render_callback_token:
        return
    token = request.headers.get("X-Render-Callback-Token")
    if token != settings.render_callback_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid callback token")


@router.post("/api/v1/render-jobs/{job_id}/heartbeat", response_model=RenderJobResponse)
def heartbeat_render_job(
    job_id: str,
    payload: RenderJobHeartbeatRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    render_service: RenderService = Depends(get_render_service),
) -> RenderJobResponse:
    _validate_callback_token(request, settings)
    try:
        return RenderJobResponse(job=render_service.heartbeat(job_id, payload))
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc


@router.post("/api/v1/render-jobs/{job_id}/callback", response_model=RenderJobResponse)
def callback_render_job(
    job_id: str,
    payload: RenderJobCallbackRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    render_service: RenderService = Depends(get_render_service),
) -> RenderJobResponse:
    _validate_callback_token(request, settings)
    try:
        return RenderJobResponse(job=render_service.apply_callback(job_id, payload))
    except JobNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found") from exc
    except InvalidRenderCallbackError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.get("/api/v1/render-jobs/{job_id}/manifest")
def get_render_manifest(
    job_id: str,
    render_service: RenderService = Depends(get_render_service),
) -> Response:
    try:
        content = render_service.get_manifest(job_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Manifest not found") from exc
    return Response(content=content, media_type="application/json")


@router.post(
    "/api/v1/agent/sessions",
    response_model=AgentSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_agent_session(
    request: CreateAgentSessionRequest,
    agent_service: AgentService = Depends(get_agent_service),
) -> AgentSessionResponse:
    try:
        return AgentSessionResponse(session=agent_service.create_session(request))
    except RecordNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown asset_id: {exc}",
        ) from exc


@router.get("/api/v1/agent/sessions/{session_id}", response_model=AgentSessionResponse)
def get_agent_session(
    session_id: str,
    agent_service: AgentService = Depends(get_agent_service),
) -> AgentSessionResponse:
    try:
        return AgentSessionResponse(session=agent_service.get_session(session_id))
    except AgentSessionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent session not found") from exc


@router.post("/api/v1/agent/sessions/{session_id}/messages", response_model=AgentRunResponse)
def send_agent_message(
    session_id: str,
    request: SendAgentMessageRequest,
    agent_service: AgentService = Depends(get_agent_service),
) -> AgentRunResponse:
    try:
        session, run = agent_service.run_message(session_id, request)
    except AgentSessionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent session not found") from exc
    except RecordNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown asset_id: {exc}",
        ) from exc
    return AgentRunResponse(session=session, run=run)
