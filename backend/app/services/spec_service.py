import json
from uuid import uuid4

from app.models.asset import AssetType
from app.models.spec import TimelineScene, WeddingVideoSpec
from app.schemas import GenerateVideoSpecRequest
from app.services.agent_llm import LLMOutputParseError, LLMProvider
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

    def generate_spec(
        self,
        request: GenerateVideoSpecRequest,
        llm_provider: LLMProvider | None = None,
    ) -> WeddingVideoSpec:
        self.template_service.get(request.template_id)
        assets = [self.asset_store.get(asset_id) for asset_id in request.asset_ids]
        media_assets = [asset for asset in assets if asset.type in {AssetType.photo, AssetType.video}]
        if not media_assets:
            raise SpecValidationError("At least one photo or video asset is required")

        if llm_provider is not None:
            try:
                spec = self._generate_spec_with_llm(request, assets, llm_provider)
                if spec:
                    return self.spec_store.save(spec)
            except (LLMOutputParseError, ValueError):
                pass

        spec = self._generate_spec_fallback(request)
        return self.spec_store.save(spec)

    def _generate_spec_fallback(self, request: GenerateVideoSpecRequest) -> WeddingVideoSpec:
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
        return spec

    def _generate_spec_with_llm(
        self,
        request: GenerateVideoSpecRequest,
        assets,
        llm_provider: LLMProvider,
    ) -> WeddingVideoSpec | None:
        template = self.template_service.get(request.template_id)
        asset_payload = [asset.model_dump(mode="json") for asset in assets]
        messages = [
            {
                "role": "system",
                "content": (
                    "你是 VowFrame 婚礼短视频剪辑师。根据素材和用户标题，生成一个可渲染的 WeddingVideoSpec JSON。\n"
                    "必须只返回 JSON，结构为 {\"assistant_message\": string, \"should_call_generate_video\": true, \"video_spec\": object}。\n"
                    "不要发明素材；timeline 中 photo/video scene 的 asset_id 必须来自资源列表中的 photo/video。\n"
                    "优先做有故事顺序的婚礼短视频：开场、地点/细节、人物、仪式/承诺、庆祝、收尾。\n"
                    "每个 media scene 时长 2-7 秒，标题和结尾 2-6 秒，整体节奏适合移动端预览。\n"
                    f"template_id: {template.id}\n"
                    f"aspect_ratio: {request.aspect_ratio}\n"
                    f"默认 style:\n{template.default_style.model_dump_json()}\n\n"
                    f"资源列表:\n{json.dumps(asset_payload, ensure_ascii=False)}\n\n"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"标题: {request.title}\n"
                    "请生成 WeddingVideoSpec，保留音乐 asset，按素材内容组织故事顺序。"
                ),
            },
        ]
        decision = llm_provider.complete(messages, [])
        if not decision.video_spec:
            return None
        return self._sanitize_llm_spec(decision.video_spec, request, assets)

    def _sanitize_llm_spec(
        self,
        llm_spec: WeddingVideoSpec,
        request: GenerateVideoSpecRequest,
        assets,
    ) -> WeddingVideoSpec:
        template = self.template_service.get(request.template_id)
        media_assets = [asset for asset in assets if asset.type in {AssetType.photo, AssetType.video}]
        media_by_id = {asset.id: asset for asset in media_assets}
        music_asset = next((asset for asset in assets if asset.type == AssetType.music), None)
        sanitized_timeline: list[TimelineScene] = []

        for index, scene in enumerate(llm_spec.timeline):
            if scene.type in {"title", "ending"}:
                text = (scene.text or request.title)[:120]
                duration = max(2, min(scene.duration_seconds, 6))
                sanitized_timeline.append(
                    TimelineScene(type=scene.type, duration_seconds=duration, text=text)
                )
                continue

            asset_id = scene.asset_id if scene.asset_id in media_by_id else None
            if not asset_id:
                if not media_assets:
                    continue
                asset_id = media_assets[min(index, len(media_assets) - 1)].id
            asset = media_by_id[asset_id]
            sanitized_timeline.append(
                TimelineScene(
                    type="video" if asset.type == AssetType.video else "photo",
                    duration_seconds=max(2, min(scene.duration_seconds, 7)),
                    asset_id=asset_id,
                    caption=scene.caption or scene.text or asset.caption or asset.description or asset.tag,
                    motion=scene.motion or template.default_style.photo_motion,
                    transition=scene.transition or template.default_style.transition,
                    parameters=scene.parameters,
                )
            )

        if not any(scene.type in {"photo", "video"} for scene in sanitized_timeline):
            return self._generate_spec_fallback(request)
        if sanitized_timeline[0].type not in {"title", "ending"}:
            sanitized_timeline.insert(
                0,
                TimelineScene(type="title", duration_seconds=4, text=request.title),
            )
        if sanitized_timeline[-1].type != "ending":
            sanitized_timeline.append(TimelineScene(type="ending", duration_seconds=4, text="Thank you"))

        style = template.default_style.model_copy(update=llm_spec.style.model_dump())
        spec = WeddingVideoSpec(
            id=str(uuid4()),
            template_id=template.id,
            title=request.title,
            aspect_ratio=request.aspect_ratio,
            duration_seconds=sum(scene.duration_seconds for scene in sanitized_timeline),
            assets=assets,
            music_asset_id=llm_spec.music_asset_id if llm_spec.music_asset_id in {asset.id for asset in assets} else (music_asset.id if music_asset else None),
            style=style,
            timeline=sanitized_timeline,
        )
        self.template_service.validate_spec(spec)
        return spec

    def save_spec(self, spec: WeddingVideoSpec) -> WeddingVideoSpec:
        self.template_service.validate_spec(spec)
        spec.touch()
        return self.spec_store.save(spec)

    def get_spec(self, spec_id: str) -> WeddingVideoSpec:
        return self.spec_store.get(spec_id)
