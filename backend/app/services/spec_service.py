from uuid import uuid4

from app.models.asset import AssetType
from app.models.spec import TimelineScene, WeddingVideoSpec
from app.schemas import GenerateVideoSpecRequest
from app.services.asset_store import FileAssetStore
from app.services.spec_store import FileSpecStore
from app.services.template_service import TemplateService


class SpecValidationError(Exception):
    pass


class VideoSpecService:
    def __init__(
        self,
        asset_store: FileAssetStore,
        spec_store: FileSpecStore,
        template_service: TemplateService,
    ) -> None:
        self.asset_store = asset_store
        self.spec_store = spec_store
        self.template_service = template_service

    def generate_spec(self, request: GenerateVideoSpecRequest) -> WeddingVideoSpec:
        template = self.template_service.get(request.template_id)
        assets = [self.asset_store.get(asset_id) for asset_id in request.asset_ids]
        media_assets = [asset for asset in assets if asset.type in {AssetType.photo, AssetType.video}]
        music_asset = next((asset for asset in assets if asset.type == AssetType.music), None)
        if not media_assets:
            raise SpecValidationError("At least one photo or video asset is required")

        timeline = [
            TimelineScene(type="title", duration_seconds=4, text=request.title),
        ]
        for asset in media_assets:
            scene_type = "video" if asset.type == AssetType.video else "photo"
            timeline.append(
                TimelineScene(
                    type=scene_type,
                    duration_seconds=5,
                    asset_id=asset.id,
                    caption=asset.caption or asset.description or asset.tag,
                    motion=template.default_style.photo_motion,
                    transition=template.default_style.transition,
                )
            )
        timeline.append(TimelineScene(type="ending", duration_seconds=4, text="Thank you"))

        duration_seconds = sum(scene.duration_seconds for scene in timeline)
        spec = WeddingVideoSpec(
            id=str(uuid4()),
            template_id=template.id,
            title=request.title,
            aspect_ratio=request.aspect_ratio,
            duration_seconds=duration_seconds,
            assets=assets,
            music_asset_id=music_asset.id if music_asset else None,
            style=template.default_style,
            timeline=timeline,
        )
        self.template_service.validate_spec(spec)
        return self.spec_store.save(spec)

    def save_spec(self, spec: WeddingVideoSpec) -> WeddingVideoSpec:
        self.template_service.validate_spec(spec)
        spec.touch()
        return self.spec_store.save(spec)

    def get_spec(self, spec_id: str) -> WeddingVideoSpec:
        return self.spec_store.get(spec_id)
