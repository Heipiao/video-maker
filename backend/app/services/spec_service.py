import json
from dataclasses import dataclass
from uuid import uuid4

from app.models.asset import Asset, AssetType
from app.models.spec import PhotoMotion, TimelineScene, Transition, WeddingVideoSpec
from app.schemas import GenerateVideoSpecRequest
from app.services.agent_llm import LLMOutputParseError, LLMProvider
from app.services.asset_store import FileAssetStore
from app.services.spec_store import FileSpecStore
from app.services.template_service import TemplateService


class SpecValidationError(Exception):
    pass


@dataclass(frozen=True)
class StorySlot:
    id: str
    tags: tuple[str, ...]
    layout: str
    duration_seconds: int
    caption: str
    prefers_video: bool = False
    allow_related_assets: bool = False


@dataclass(frozen=True)
class StylePreset:
    id: str
    title_suffix: str
    primary_color: str
    font: str
    filter_preset: str
    transition_out: str
    motion: PhotoMotion
    transition: Transition
    music_volume: float
    title_duration_seconds: int
    ending_duration_seconds: int
    slots: tuple[StorySlot, ...]


STYLE_PRESETS: dict[str, StylePreset] = {
    "nostalgia_editorial": StylePreset(
        id="nostalgia_editorial",
        title_suffix="Nostalgia",
        primary_color="#D83A52",
        font="Playfair Display",
        filter_preset="warm_grain",
        transition_out="light_leak",
        motion=PhotoMotion.slow_zoom,
        transition=Transition.crossfade,
        music_volume=0.68,
        title_duration_seconds=4,
        ending_duration_seconds=4,
        slots=(
            StorySlot("opening", ("couple", "hero", "portrait", "first look"), "full_photo_title", 4, "The beginning"),
            StorySlot("place", ("venue", "details", "establishing", "sunset"), "stacked_memory_cards", 5, "The place"),
            StorySlot("family", ("family", "parents", "friends", "candid"), "split_photo_caption", 5, "Everyone close"),
            StorySlot("vows", ("vows", "rings", "ceremony", "kiss"), "detail_to_hero", 5, "The promise"),
            StorySlot("celebration", ("dance", "reception", "party", "motion"), "rhythm_montage", 4, "After the yes", True, True),
        ),
    ),
    "reels_party_cut": StylePreset(
        id="reels_party_cut",
        title_suffix="Party Cut",
        primary_color="#E43F5A",
        font="Inter",
        filter_preset="reels_pop",
        transition_out="beat_cut",
        motion=PhotoMotion.pan_right,
        transition=Transition.cut,
        music_volume=0.78,
        title_duration_seconds=3,
        ending_duration_seconds=3,
        slots=(
            StorySlot("hook", ("dance", "party", "motion", "kiss"), "rhythm_montage", 3, "Hit play", True, True),
            StorySlot("couple", ("couple", "first look", "portrait", "hero"), "full_photo_title", 3, "Main characters"),
            StorySlot("crew", ("friends", "family", "reception", "candid"), "stacked_memory_cards", 4, "The crew", False, True),
            StorySlot("vows", ("vows", "rings", "ceremony"), "split_photo_caption", 4, "The reason"),
            StorySlot("finish", ("dance", "party", "sendoff", "finale"), "rhythm_montage", 3, "Last look", True, True),
        ),
    ),
    "clean_film_trailer": StylePreset(
        id="clean_film_trailer",
        title_suffix="Film",
        primary_color="#F4F1EA",
        font="Inter",
        filter_preset="clean_bw",
        transition_out="soft_crossfade",
        motion=PhotoMotion.slow_zoom,
        transition=Transition.crossfade,
        music_volume=0.62,
        title_duration_seconds=5,
        ending_duration_seconds=5,
        slots=(
            StorySlot("opening", ("hero", "couple", "portrait", "first look"), "full_photo_title", 5, "A quiet opening"),
            StorySlot("place", ("venue", "details", "establishing"), "split_photo_caption", 5, "Where it happened"),
            StorySlot("promise", ("vows", "rings", "ceremony", "kiss"), "detail_to_hero", 6, "The promise"),
            StorySlot("after", ("family", "friends", "dance", "reception"), "stacked_memory_cards", 5, "After the ceremony", False, True),
        ),
    ),
    "guest_pov_recap": StylePreset(
        id="guest_pov_recap",
        title_suffix="Guest POV",
        primary_color="#D83A52",
        font="Inter",
        filter_preset="camera_roll",
        transition_out="flash_white",
        motion=PhotoMotion.pan_left,
        transition=Transition.cut,
        music_volume=0.72,
        title_duration_seconds=3,
        ending_duration_seconds=3,
        slots=(
            StorySlot("arrival", ("venue", "friends", "candid", "details"), "stacked_memory_cards", 4, "From the camera roll", False, True),
            StorySlot("couple", ("couple", "first look", "kiss"), "full_photo_title", 4, "The two of you"),
            StorySlot("ceremony", ("vows", "rings", "ceremony", "family"), "split_photo_caption", 4, "The ceremony"),
            StorySlot("party", ("dance", "reception", "party", "motion"), "rhythm_montage", 4, "The party", True, True),
            StorySlot("finale", ("sendoff", "sunset", "finale", "couple"), "finale_photo_card", 4, "One more frame"),
        ),
    ),
}


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

        preset = STYLE_PRESETS.get(request.style_preset_id, STYLE_PRESETS["nostalgia_editorial"])
        transition = (
            preset.transition
            if self._style_value_allowed(template.editable_schema, "transition", preset.transition)
            else template.default_style.transition
        )
        motion = (
            preset.motion
            if self._style_value_allowed(template.editable_schema, "photo_motion", preset.motion)
            else template.default_style.photo_motion
        )
        font = (
            preset.font
            if self._style_value_allowed(template.editable_schema, "font", preset.font)
            else template.default_style.font
        )
        style = template.default_style.model_copy(
            update={
                "font": font,
                "primary_color": preset.primary_color,
                "transition": transition,
                "photo_motion": motion,
                "music_volume": preset.music_volume,
                "style_preset_id": preset.id,
                "filter_preset": preset.filter_preset,
            }
        )
        timeline = self._build_timeline(request.title, media_assets, preset)

        duration_seconds = sum(scene.duration_seconds for scene in timeline)
        spec = WeddingVideoSpec(
            id=str(uuid4()),
            template_id=template.id,
            title=request.title,
            aspect_ratio=request.aspect_ratio,
            duration_seconds=duration_seconds,
            assets=assets,
            music_asset_id=music_asset.id if music_asset else None,
            style=style,
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

    def generate_modified_spec(
        self,
        base_spec: WeddingVideoSpec,
        prompt: str,
        llm_provider: LLMProvider | None = None,
    ) -> WeddingVideoSpec:
        if llm_provider is not None:
            try:
                llm_spec = self._generate_modified_spec_with_llm(base_spec, prompt, llm_provider)
                if llm_spec:
                    return self.spec_store.save(llm_spec)
            except LLMOutputParseError:
                pass
            except ValueError:
                pass
        fallback = self._generate_modified_spec_fallback(base_spec, prompt)
        return self.spec_store.save(fallback)

    def _style_value_allowed(self, editable_schema: dict, key: str, value: object) -> bool:
        editable_style = editable_schema.get("style", {})
        allowed_values = editable_style.get(key)
        if not isinstance(allowed_values, list):
            return True
        return str(value) in {str(item) for item in allowed_values}

    def _generate_modified_spec_with_llm(
        self,
        base_spec: WeddingVideoSpec,
        prompt: str,
        llm_provider: LLMProvider,
    ) -> WeddingVideoSpec | None:
        asset_payload = [
            asset.model_dump(mode="json")
            for asset in base_spec.assets
            if asset.type in {AssetType.photo, AssetType.video, AssetType.music}
        ]
        messages = [
            {
                "role": "system",
                "content": (
                    "你是 VowFrame 婚礼短视频剪辑师。根据用户自然语言修改要求，重新生成一个可渲染的 WeddingVideoSpec JSON。\n"
                    "必须只返回 JSON，结构为 {\"assistant_message\": string, \"should_call_generate_video\": true, \"video_spec\": object}。\n"
                    "保持所有 asset_id 来自资源列表，不要发明素材。优先输出竖屏 9:16、短视频节奏、多布局、少文案。\n"
                    "video_spec 必须包含 id/template_id/title/aspect_ratio/duration_seconds/assets/music_asset_id/style/timeline。\n"
                    "timeline 每个 media scene 只能使用 photo/video 类型素材，duration_seconds 2-7 秒。\n\n"
                    f"当前 VideoSpec:\n{base_spec.model_dump_json()}\n\n"
                    f"资源列表:\n{json.dumps(asset_payload, ensure_ascii=False)}\n\n"
                ),
            },
            {"role": "user", "content": prompt},
        ]
        decision = llm_provider.complete(messages, [])
        if not decision.video_spec:
            return None
        spec_payload = decision.video_spec.model_dump(mode="json")
        spec_payload["id"] = str(uuid4())
        spec_payload["template_id"] = base_spec.template_id
        spec_payload["aspect_ratio"] = base_spec.aspect_ratio
        spec_payload["assets"] = [asset.model_dump(mode="json") for asset in base_spec.assets]
        spec_payload["music_asset_id"] = (
            spec_payload.get("music_asset_id")
            if spec_payload.get("music_asset_id") in {asset.id for asset in base_spec.assets}
            else base_spec.music_asset_id
        )
        spec_payload["timeline"] = self._sanitize_modified_timeline(spec_payload.get("timeline", []), base_spec, prompt)
        spec_payload["duration_seconds"] = sum(scene["duration_seconds"] for scene in spec_payload["timeline"])
        spec_payload["style"] = {
            **(spec_payload.get("style") or {}),
            **self._style_for_prompt(base_spec, prompt).model_dump(mode="json"),
            "style_preset_id": self._preset_id_for_prompt(prompt),
            "filter_preset": STYLE_PRESETS[self._preset_id_for_prompt(prompt)].filter_preset,
        }
        return WeddingVideoSpec.model_validate(spec_payload)

    def _generate_modified_spec_fallback(self, base_spec: WeddingVideoSpec, prompt: str) -> WeddingVideoSpec:
        preset_id = self._preset_id_for_prompt(prompt)
        request = GenerateVideoSpecRequest(
            template_id=base_spec.template_id,
            title=base_spec.title,
            asset_ids=[asset.id for asset in base_spec.assets],
            aspect_ratio=base_spec.aspect_ratio,
            style_preset_id=preset_id,
        )
        template = self.template_service.get(request.template_id)
        media_assets = [asset for asset in base_spec.assets if asset.type in {AssetType.photo, AssetType.video}]
        music_asset = next((asset for asset in base_spec.assets if asset.type == AssetType.music), None)
        preset = STYLE_PRESETS[preset_id]
        timeline = self._build_timeline(base_spec.title, media_assets, preset)
        timeline = [
            scene.model_copy(
                update={
                    "parameters": {
                        **scene.parameters,
                        "modify_prompt": prompt,
                        "llm_fallback": True,
                    }
                }
            )
            for scene in timeline
        ]
        return WeddingVideoSpec(
            id=str(uuid4()),
            template_id=template.id,
            title=base_spec.title,
            aspect_ratio=base_spec.aspect_ratio,
            duration_seconds=sum(scene.duration_seconds for scene in timeline),
            assets=base_spec.assets,
            music_asset_id=music_asset.id if music_asset else base_spec.music_asset_id,
            style=self._style_for_prompt(base_spec, prompt),
            timeline=timeline,
        )

    def _sanitize_modified_timeline(
        self,
        raw_timeline: list[dict],
        base_spec: WeddingVideoSpec,
        prompt: str,
    ) -> list[dict]:
        valid_assets = {asset.id: asset for asset in base_spec.assets if asset.type in {AssetType.photo, AssetType.video}}
        sanitized: list[dict] = []
        for scene in raw_timeline:
            if not isinstance(scene, dict):
                continue
            scene_type = scene.get("type")
            if scene_type in {"title", "ending"}:
                text = str(scene.get("text") or scene.get("caption") or base_spec.title)[:120]
                sanitized.append(
                    {
                        "type": scene_type,
                        "duration_seconds": max(2, min(int(scene.get("duration_seconds") or 4), 8)),
                        "text": text,
                        "parameters": {
                            **(scene.get("parameters") or {}),
                            "style_preset_id": self._preset_id_for_prompt(prompt),
                            "modify_prompt": prompt,
                        },
                    }
                )
                continue
            asset_id = scene.get("asset_id")
            asset = valid_assets.get(asset_id)
            if not asset:
                continue
            sanitized.append(
                {
                    "type": "video" if asset.type == AssetType.video else "photo",
                    "duration_seconds": max(2, min(int(scene.get("duration_seconds") or 4), 7)),
                    "asset_id": asset.id,
                    "caption": scene.get("caption") or asset.caption or asset.description or asset.tag,
                    "motion": scene.get("motion") or "slow_zoom",
                    "transition": scene.get("transition") or "crossfade",
                    "parameters": {
                        **(scene.get("parameters") or {}),
                        "style_preset_id": self._preset_id_for_prompt(prompt),
                        "filter_preset": STYLE_PRESETS[self._preset_id_for_prompt(prompt)].filter_preset,
                        "layout": (scene.get("parameters") or {}).get("layout") or "full_photo_title",
                        "modify_prompt": prompt,
                    },
                }
            )
        if not any(scene["type"] in {"photo", "video"} for scene in sanitized):
            return [scene.model_dump(mode="json") for scene in self._generate_modified_spec_fallback(base_spec, prompt).timeline]
        if not sanitized or sanitized[0]["type"] != "title":
            sanitized.insert(
                0,
                {
                    "type": "title",
                    "duration_seconds": 3,
                    "text": base_spec.title,
                    "parameters": {"style_preset_id": self._preset_id_for_prompt(prompt), "modify_prompt": prompt},
                },
            )
        if sanitized[-1]["type"] != "ending":
            sanitized.append(
                {
                    "type": "ending",
                    "duration_seconds": 3,
                    "text": "Revised cut",
                    "parameters": {"style_preset_id": self._preset_id_for_prompt(prompt), "modify_prompt": prompt},
                }
            )
        return sanitized

    def _style_for_prompt(self, base_spec: WeddingVideoSpec, prompt: str):
        preset = STYLE_PRESETS[self._preset_id_for_prompt(prompt)]
        return base_spec.style.model_copy(
            update={
                "font": preset.font,
                "primary_color": preset.primary_color,
                "transition": preset.transition,
                "photo_motion": preset.motion,
                "music_volume": preset.music_volume,
                "style_preset_id": preset.id,
                "filter_preset": preset.filter_preset,
            }
        )

    def _preset_id_for_prompt(self, prompt: str) -> str:
        normalized = prompt.lower()
        if any(token in normalized for token in ("party", "dance", "fast", "beat", "energetic", "reels")):
            return "reels_party_cut"
        if any(token in normalized for token in ("film", "cinematic", "black", "white", "clean", "minimal")):
            return "clean_film_trailer"
        if any(token in normalized for token in ("guest", "candid", "pov", "camera roll", "friends")):
            return "guest_pov_recap"
        return "nostalgia_editorial"

    def _build_timeline(
        self,
        title: str,
        media_assets: list[Asset],
        preset: StylePreset,
    ) -> list[TimelineScene]:
        used_asset_ids: set[str] = set()
        timeline = [
            TimelineScene(
                type="title",
                duration_seconds=preset.title_duration_seconds,
                text=title,
                parameters={
                    "style_preset_id": preset.id,
                    "layout": "opening_title",
                    "filter_preset": preset.filter_preset,
                    "transition_out": preset.transition_out,
                },
            )
        ]

        for slot_index, slot in enumerate(preset.slots):
            asset = self._select_asset(media_assets, slot, used_asset_ids, slot_index)
            if asset.id not in used_asset_ids:
                used_asset_ids.add(asset.id)
            related_asset_ids = (
                self._select_related_asset_ids(media_assets, asset, slot, used_asset_ids)
                if slot.allow_related_assets
                else []
            )
            used_asset_ids.update(related_asset_ids)
            scene_type = "video" if asset.type == AssetType.video else "photo"
            timeline.append(
                TimelineScene(
                    type=scene_type,
                    duration_seconds=slot.duration_seconds,
                    asset_id=asset.id,
                    caption=asset.caption or asset.description or slot.caption,
                    motion=preset.motion,
                    transition=preset.transition,
                    parameters={
                        "style_preset_id": preset.id,
                        "slot": slot.id,
                        "slot_tags": list(slot.tags),
                        "layout": slot.layout,
                        "filter_preset": preset.filter_preset,
                        "transition_out": self._transition_for_slot(preset, slot_index),
                        "media_start": 0 if asset.type == AssetType.video else None,
                        "crop_mode": self._crop_mode(asset),
                        "asset_score": round(self._score_asset(asset, slot, used_asset_ids=set()), 3),
                        "related_asset_ids": related_asset_ids,
                    },
                )
            )

        timeline.append(
            TimelineScene(
                type="ending",
                duration_seconds=preset.ending_duration_seconds,
                text="Save the reel",
                parameters={
                    "style_preset_id": preset.id,
                    "layout": "ending_card",
                    "filter_preset": preset.filter_preset,
                    "transition_out": "fade_to_black",
                },
            )
        )
        return timeline

    def _select_asset(
        self,
        assets: list[Asset],
        slot: StorySlot,
        used_asset_ids: set[str],
        slot_index: int,
    ) -> Asset:
        ranked = sorted(
            enumerate(assets),
            key=lambda item: (
                self._score_asset(item[1], slot, used_asset_ids),
                -abs(item[0] - slot_index),
            ),
            reverse=True,
        )
        return ranked[0][1]

    def _select_related_asset_ids(
        self,
        assets: list[Asset],
        primary_asset: Asset,
        slot: StorySlot,
        used_asset_ids: set[str],
    ) -> list[str]:
        ranked = sorted(
            (
                asset
                for asset in assets
                if asset.id != primary_asset.id and asset.id not in used_asset_ids
            ),
            key=lambda asset: self._score_asset(asset, slot, used_asset_ids),
            reverse=True,
        )
        return [asset.id for asset in ranked[:2]]

    def _score_asset(self, asset: Asset, slot: StorySlot, used_asset_ids: set[str]) -> float:
        tags = self._asset_tags(asset)
        tag_score = sum(1 for tag in slot.tags if tag in tags) * 2.8
        fuzzy_score = sum(1 for tag in tags if any(tag in slot_tag or slot_tag in tag for slot_tag in slot.tags)) * 0.7
        quality = asset.analysis.visual.quality_score if asset.analysis.visual else None
        quality_score = quality if quality is not None else 0.58
        video_score = 1.8 if slot.prefers_video and asset.type == AssetType.video else 0
        photo_score = 0.4 if not slot.prefers_video and asset.type == AssetType.photo else 0
        repeat_penalty = 3.5 if asset.id in used_asset_ids else 0
        return tag_score + fuzzy_score + quality_score + video_score + photo_score - repeat_penalty

    def _asset_tags(self, asset: Asset) -> set[str]:
        raw_tags = {asset.tag, asset.description or "", asset.caption or ""}
        if asset.analysis.visual:
            raw_tags.update(asset.analysis.visual.detected_tags)
            if asset.analysis.visual.mood:
                raw_tags.add(asset.analysis.visual.mood)
        metadata_tags = asset.metadata.get("tags")
        if isinstance(metadata_tags, list):
            raw_tags.update(str(tag) for tag in metadata_tags)
        return {
            tag.strip().lower().replace("_", " ")
            for raw_tag in raw_tags
            for tag in str(raw_tag).split(",")
            if tag.strip()
        }

    def _crop_mode(self, asset: Asset) -> str:
        width = self._metadata_number(asset, "width")
        height = self._metadata_number(asset, "height")
        if width and height and width > height:
            return "card_pan"
        return "full_frame"

    def _metadata_number(self, asset: Asset, key: str) -> float | None:
        value = asset.metadata.get(key)
        return value if isinstance(value, int | float) else None

    def _transition_for_slot(self, preset: StylePreset, slot_index: int) -> str:
        if preset.id == "reels_party_cut":
            return "flash_white" if slot_index % 2 else "beat_cut"
        if preset.id == "guest_pov_recap":
            return "camera_flash" if slot_index % 2 else "hard_cut"
        if preset.id == "clean_film_trailer":
            return "soft_crossfade"
        return "paper_wipe" if slot_index % 2 else preset.transition_out
