from app.models.spec import WeddingVideoSpec
from app.schemas import CreateRenderJobRequest
from app.services.render_service import RenderService
from app.services.spec_service import VideoSpecService


class GenerateVideoTool:
    name = "generate_video"

    def __init__(
        self,
        spec_service: VideoSpecService,
        render_service: RenderService,
        global_render_path_template: str,
    ) -> None:
        self.spec_service = spec_service
        self.render_service = render_service
        self.global_render_path_template = global_render_path_template

    def definition(self) -> dict:
        return {
            "name": self.name,
            "description": "Save a complete VideoSpec and create a manifest render job.",
            "parameters": {
                "type": "object",
                "properties": {"video_spec": {"type": "object"}},
                "required": ["video_spec"],
            },
        }

    def call(self, video_spec: WeddingVideoSpec) -> dict:
        spec = self.spec_service.save_spec(video_spec)
        job = self.render_service.create_job(CreateRenderJobRequest(spec_id=spec.id, renderer="manifest"))
        global_render_path = self.global_render_path_template.format(
            job_id=job.id,
            spec_id=spec.id,
        )
        return {
            "spec_id": spec.id,
            "render_job_id": job.id,
            "manifest_url": job.manifest_url,
            "output_url": job.output_url,
            "global_render_path": global_render_path,
        }
