from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    storage_dir: Path = Path("storage")
    global_render_path: str = "/api/v1/render-jobs/{job_id}/manifest"
    agent_llm_provider: str = "deepseek"
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-pro"
    deepseek_timeout_seconds: float = 60
    remotion_command: str | None = "node ../renderer/remotion/render.mjs {manifest_path} {output_path}"
    remotion_timeout_seconds: float = 300
    public_base_url: str = "http://127.0.0.1:8017"
    oss_enabled: bool = False
    oss_endpoint: str | None = None
    oss_bucket: str | None = None
    oss_access_key_id: str | None = None
    oss_access_key_secret: str | None = None
    oss_prefix: str = "wedding-videos"
    oss_public_base_url: str | None = None
    oss_timeout_seconds: float = 120
    oss_cleanup_local_output: bool = True
    render_mode: str = "local"
    aliyun_access_key_id: str | None = None
    aliyun_access_key_secret: str | None = None
    eci_region_id: str = "cn-hangzhou"
    eci_vswitch_id: str | None = None
    eci_security_group_id: str | None = None
    eci_renderer_image: str | None = None
    eci_cpu: float = 4
    eci_memory: float = 8
    eci_active_deadline_seconds: int = 1800
    eci_spot_strategy: str = "SpotAsPriceGo"
    eci_spot_price_limit: float | None = None
    eci_spot_fallback: bool = True
    eci_ephemeral_storage: str = "50Gi"
    eci_max_attempts: int = 3
    eci_ram_role_name: str | None = None
    render_callback_token: str | None = None

    model_config = SettingsConfigDict(env_prefix="VIDEO_MAKER_", env_file=(".env", "../.env"))

    @field_validator("eci_spot_price_limit", mode="before")
    @classmethod
    def empty_float_as_none(cls, value):
        if value == "":
            return None
        return value

    @property
    def assets_dir(self) -> Path:
        return self.storage_dir / "assets"

    @property
    def specs_dir(self) -> Path:
        return self.storage_dir / "specs"

    @property
    def jobs_dir(self) -> Path:
        return self.storage_dir / "jobs"

    @property
    def outputs_dir(self) -> Path:
        return self.storage_dir / "outputs"

    @property
    def uploads_dir(self) -> Path:
        return self.storage_dir / "uploads"

    @property
    def agent_sessions_dir(self) -> Path:
        return self.storage_dir / "agent_sessions"

    @property
    def agent_runs_dir(self) -> Path:
        return self.storage_dir / "agent_runs"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.assets_dir.mkdir(parents=True, exist_ok=True)
    settings.specs_dir.mkdir(parents=True, exist_ok=True)
    settings.jobs_dir.mkdir(parents=True, exist_ok=True)
    settings.outputs_dir.mkdir(parents=True, exist_ok=True)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    settings.agent_sessions_dir.mkdir(parents=True, exist_ok=True)
    settings.agent_runs_dir.mkdir(parents=True, exist_ok=True)
    return settings
