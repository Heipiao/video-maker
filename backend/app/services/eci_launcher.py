from dataclasses import dataclass

from app.core.settings import Settings
from app.models.render import RenderJob


class EciConfigError(Exception):
    pass


class EciLaunchError(Exception):
    pass


@dataclass(frozen=True)
class EciLaunchRequest:
    job: RenderJob
    manifest_url: str
    manifest_oss_key: str
    output_oss_key: str
    callback_url: str
    heartbeat_url: str
    callback_token: str | None


@dataclass(frozen=True)
class EciLaunchResult:
    container_group_id: str


class EciLauncher:
    def __init__(self, settings: Settings, client=None) -> None:
        self.settings = settings
        self.client = client

    def launch(self, request: EciLaunchRequest) -> EciLaunchResult:
        self._validate_config()
        sdk_client = self.client or self._create_client()
        sdk_request = self.build_create_request(request)
        try:
            response = sdk_client.create_container_group(sdk_request)
        except Exception as exc:
            raise EciLaunchError(str(exc)) from exc

        body = getattr(response, "body", response)
        container_group_id = getattr(body, "container_group_id", None)
        if not container_group_id and isinstance(body, dict):
            container_group_id = body.get("ContainerGroupId") or body.get("container_group_id")
        if not container_group_id:
            raise EciLaunchError("ECI CreateContainerGroup response did not include container_group_id")
        return EciLaunchResult(container_group_id=container_group_id)

    def build_create_request(self, request: EciLaunchRequest):
        from alibabacloud_eci20180808 import models as eci_models

        env = [
            eci_models.CreateContainerGroupRequestContainerEnvironmentVar(key=key, value=value)
            for key, value in self._worker_env(request).items()
            if value is not None
        ]
        container = eci_models.CreateContainerGroupRequestContainer(
            name="renderer",
            image=self.settings.eci_renderer_image,
            image_pull_policy="IfNotPresent",
            cpu=self.settings.eci_cpu,
            memory=self.settings.eci_memory,
            environment_var=env,
            environment_var_hide=True,
            command=["python", "-m", "app.worker.render_job"],
            arg=[
                "--job-id",
                request.job.id,
                "--manifest-url",
                request.manifest_url,
                "--output-oss-key",
                request.output_oss_key,
                "--callback-url",
                request.callback_url,
                "--heartbeat-url",
                request.heartbeat_url,
            ],
        )
        sdk_request = eci_models.CreateContainerGroupRequest(
            region_id=self.settings.eci_region_id,
            v_switch_id=self.settings.eci_vswitch_id,
            security_group_id=self.settings.eci_security_group_id,
            container_group_name=self._container_group_name(request.job),
            client_token=f"render-{request.job.id}-{request.job.attempt_count}",
            restart_policy="Never",
            auto_match_image_cache=True,
            cpu=self.settings.eci_cpu,
            memory=self.settings.eci_memory,
            active_deadline_seconds=self.settings.eci_active_deadline_seconds,
            ephemeral_storage=self._ephemeral_storage_gib(),
            spot_strategy=self.settings.eci_spot_strategy,
            strict_spot=not self.settings.eci_spot_fallback,
            ram_role_name=self.settings.eci_ram_role_name,
            container=[container],
        )
        if self.settings.eci_spot_price_limit is not None:
            sdk_request.spot_price_limit = self.settings.eci_spot_price_limit
        return sdk_request

    def _worker_env(self, request: EciLaunchRequest) -> dict[str, str | None]:
        return {
            "VIDEO_MAKER_JOB_ID": request.job.id,
            "VIDEO_MAKER_MANIFEST_URL": request.manifest_url,
            "VIDEO_MAKER_MANIFEST_OSS_KEY": request.manifest_oss_key,
            "VIDEO_MAKER_OUTPUT_OSS_KEY": request.output_oss_key,
            "VIDEO_MAKER_RENDER_CALLBACK_URL": request.callback_url,
            "VIDEO_MAKER_RENDER_HEARTBEAT_URL": request.heartbeat_url,
            "VIDEO_MAKER_RENDER_CALLBACK_TOKEN": request.callback_token,
            "VIDEO_MAKER_REMOTION_COMMAND": "node remotion/render.mjs {manifest_path} {output_path}",
            "VIDEO_MAKER_PUBLIC_BASE_URL": (
                self.settings.render_callback_base_url or self.settings.public_base_url
            ),
            "VIDEO_MAKER_ASSET_REWRITE_FROM": self.settings.public_base_url,
            "VIDEO_MAKER_ASSET_REWRITE_TO": self.settings.render_callback_base_url,
            "VIDEO_MAKER_OSS_ENDPOINT": self.settings.oss_endpoint,
            "VIDEO_MAKER_OSS_BUCKET": self.settings.oss_bucket,
            "VIDEO_MAKER_OSS_ACCESS_KEY_ID": self.settings.oss_access_key_id,
            "VIDEO_MAKER_OSS_ACCESS_KEY_SECRET": self.settings.oss_access_key_secret,
            "VIDEO_MAKER_OSS_PREFIX": self.settings.oss_prefix,
            "VIDEO_MAKER_OSS_PUBLIC_BASE_URL": self.settings.oss_public_base_url,
        }

    def _validate_config(self) -> None:
        missing = []
        if not self.settings.oss_enabled:
            missing.append("VIDEO_MAKER_OSS_ENABLED=true")
        for attr, env_name in [
            ("oss_endpoint", "VIDEO_MAKER_OSS_ENDPOINT"),
            ("oss_bucket", "VIDEO_MAKER_OSS_BUCKET"),
            ("oss_access_key_id", "VIDEO_MAKER_OSS_ACCESS_KEY_ID"),
            ("oss_access_key_secret", "VIDEO_MAKER_OSS_ACCESS_KEY_SECRET"),
            ("eci_renderer_image", "VIDEO_MAKER_ECI_RENDERER_IMAGE"),
            ("eci_vswitch_id", "VIDEO_MAKER_ECI_VSWITCH_ID"),
            ("eci_security_group_id", "VIDEO_MAKER_ECI_SECURITY_GROUP_ID"),
        ]:
            if not getattr(self.settings, attr):
                missing.append(env_name)
        if self.client is None:
            for attr, env_name in [
                ("aliyun_access_key_id", "VIDEO_MAKER_ALIYUN_ACCESS_KEY_ID"),
                ("aliyun_access_key_secret", "VIDEO_MAKER_ALIYUN_ACCESS_KEY_SECRET"),
            ]:
                if not getattr(self.settings, attr):
                    missing.append(env_name)
        if missing:
            raise EciConfigError("Missing ECI configuration: " + ", ".join(missing))

    def _create_client(self):
        from alibabacloud_eci20180808.client import Client
        from alibabacloud_tea_openapi import models as openapi_models

        config = openapi_models.Config(
            access_key_id=self.settings.aliyun_access_key_id,
            access_key_secret=self.settings.aliyun_access_key_secret,
            region_id=self.settings.eci_region_id,
        )
        config.endpoint = f"eci.{self.settings.eci_region_id}.aliyuncs.com"
        return Client(config)

    def _ephemeral_storage_gib(self) -> int:
        value = str(self.settings.eci_ephemeral_storage).strip()
        if value.lower().endswith("gi"):
            value = value[:-2]
        elif value.lower().endswith("gib"):
            value = value[:-3]
        try:
            storage = int(value)
        except ValueError as exc:
            raise EciConfigError("VIDEO_MAKER_ECI_EPHEMERAL_STORAGE must be like 50Gi") from exc
        if storage <= 0:
            raise EciConfigError("VIDEO_MAKER_ECI_EPHEMERAL_STORAGE must be positive")
        return storage

    def _container_group_name(self, job: RenderJob) -> str:
        suffix = job.id.replace("-", "")[:12]
        return f"vowframe-render-{suffix}-{job.attempt_count}"
