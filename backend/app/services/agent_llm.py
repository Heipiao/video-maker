import json
import os
import urllib.error
import urllib.request
from typing import Protocol
from uuid import uuid4

from pydantic import BaseModel, ValidationError

from app.models.asset import AssetType
from app.models.spec import TimelineScene, WeddingVideoSpec


class AgentDecision(BaseModel):
    assistant_message: str
    video_spec: WeddingVideoSpec | None = None
    should_call_generate_video: bool = False


class LLMProvider(Protocol):
    def complete(self, messages: list[dict], tools: list[dict]) -> AgentDecision:
        ...


class LLMOutputParseError(Exception):
    pass


class MockLLMProvider:
    def complete(self, messages: list[dict], tools: list[dict]) -> AgentDecision:
        system = messages[0]["content"] if messages else ""
        assets = self._extract_assets(system)
        media_assets = [asset for asset in assets if asset.get("type") in {AssetType.photo, AssetType.video}]
        music_asset = next((asset for asset in assets if asset.get("type") == AssetType.music), None)
        if not media_assets:
            return AgentDecision(
                assistant_message="还需要至少一张图片或一段视频素材，才能生成视频脚本。",
                should_call_generate_video=False,
            )

        title = "Generated Video"
        user_message = messages[-1].get("content") if messages else ""
        if user_message:
            title = user_message[:80]

        timeline = [TimelineScene(type="title", duration_seconds=4, text=title)]
        for asset in media_assets:
            scene_type = "video" if asset["type"] == AssetType.video else "photo"
            timeline.append(
                TimelineScene(
                    type=scene_type,
                    duration_seconds=5,
                    asset_id=asset["id"],
                    caption=asset.get("caption") or asset.get("description") or asset.get("tag"),
                    motion="slow_zoom",
                    transition="crossfade",
                )
            )
        timeline.append(TimelineScene(type="ending", duration_seconds=4, text="Thank you"))
        duration_seconds = sum(scene.duration_seconds for scene in timeline)

        spec = WeddingVideoSpec(
            id=str(uuid4()),
            template_id="classic_wedding",
            title=title,
            duration_seconds=duration_seconds,
            assets=assets,
            music_asset_id=music_asset["id"] if music_asset else None,
            timeline=timeline,
        )
        return AgentDecision(
            assistant_message="已根据素材生成视频脚本，并准备创建渲染任务。",
            video_spec=spec,
            should_call_generate_video=True,
        )

    @staticmethod
    def _extract_assets(system_content: str) -> list[dict]:
        marker = "资源列表:\n"
        start = system_content.find(marker)
        if start < 0:
            return []
        start += len(marker)
        end = system_content.find("\n\n", start)
        raw = system_content[start:] if end < 0 else system_content[start:end]
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []


class OpenAICompatibleLLMProvider:
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = "https://api.deepseek.com",
        model: str = "deepseek-v4-pro",
        timeout_seconds: float = 60,
    ) -> None:
        self.api_key = api_key or os.getenv("DEEPSEEK_API_KEY")
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds

    def complete(self, messages: list[dict], tools: list[dict]) -> AgentDecision:
        if not self.api_key:
            raise LLMOutputParseError("DEEPSEEK_API_KEY is required for DeepSeek LLM provider")

        payload = {
            "model": self.model,
            "messages": messages,
            "tools": [{"type": "function", "function": tool} for tool in tools],
            "tool_choice": "none",
            "response_format": {"type": "json_object"},
            "temperature": 0.2,
        }
        request = urllib.request.Request(
            url=f"{self.base_url}/chat/completions",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            raise LLMOutputParseError(
                f"DeepSeek API HTTP {exc.code}: {error_body[:1000]}"
            ) from exc
        except urllib.error.URLError as exc:
            raise LLMOutputParseError(f"DeepSeek API request failed: {exc}") from exc

        try:
            completion = json.loads(body)
            content = completion["choices"][0]["message"]["content"]
            decision_payload = json.loads(content)
            try:
                return AgentDecision.model_validate(decision_payload)
            except ValidationError as validation_error:
                repaired = self._repair_decision(decision_payload, messages)
                if repaired:
                    return repaired
                raise validation_error
        except Exception as exc:
            raise LLMOutputParseError(f"Invalid DeepSeek decision JSON: {exc}") from exc

    def _repair_decision(self, payload: dict, messages: list[dict]) -> AgentDecision | None:
        if not isinstance(payload, dict) or not isinstance(payload.get("video_spec"), dict):
            return None

        assets = MockLLMProvider._extract_assets(messages[0]["content"] if messages else "")
        media_assets = [asset for asset in assets if asset.get("type") in {AssetType.photo, AssetType.video}]
        if not media_assets:
            return AgentDecision(
                assistant_message=payload.get("assistant_message")
                or "还需要至少一张图片或一段视频素材，才能生成视频脚本。",
                should_call_generate_video=False,
            )

        spec_payload = payload["video_spec"]
        user_message = messages[-1].get("content") if messages else ""
        title = (
            spec_payload.get("title")
            or payload.get("assistant_message")
            or user_message
            or "Generated Video"
        )[:120]
        aspect_ratio = self._infer_aspect_ratio(spec_payload)
        timeline = self._coerce_timeline(spec_payload, media_assets, title)
        music_asset = next((asset for asset in assets if asset.get("type") == AssetType.music), None)
        duration_seconds = sum(scene.duration_seconds for scene in timeline)
        spec = WeddingVideoSpec(
            id=spec_payload.get("id") or str(uuid4()),
            template_id=spec_payload.get("template_id") or "classic_wedding",
            title=title,
            aspect_ratio=aspect_ratio,
            duration_seconds=duration_seconds,
            assets=assets,
            music_asset_id=spec_payload.get("music_asset_id")
            or spec_payload.get("music", {}).get("asset_id")
            or (music_asset["id"] if music_asset else None),
            style=spec_payload.get("style") or {},
            timeline=timeline,
        )
        return AgentDecision(
            assistant_message=payload.get("assistant_message")
            or "已把视频脚本转换为系统可渲染的 VideoSpec。",
            video_spec=spec,
            should_call_generate_video=bool(payload.get("should_call_generate_video", True)),
        )

    @staticmethod
    def _infer_aspect_ratio(spec_payload: dict) -> str:
        if spec_payload.get("aspect_ratio") in {"16:9", "9:16", "1:1"}:
            return spec_payload["aspect_ratio"]
        resolution = spec_payload.get("resolution") or {}
        width = resolution.get("width") or 0
        height = resolution.get("height") or 0
        if width and height:
            if height > width:
                return "9:16"
            if width == height:
                return "1:1"
        return "16:9"

    @staticmethod
    def _coerce_timeline(spec_payload: dict, media_assets: list[dict], title: str) -> list[TimelineScene]:
        asset_ids = {asset["id"] for asset in media_assets}
        raw_timeline = (
            spec_payload.get("timeline")
            or spec_payload.get("scenes")
            or spec_payload.get("clips")
            or []
        )
        timeline: list[TimelineScene] = [TimelineScene(type="title", duration_seconds=4, text=title)]
        if isinstance(raw_timeline, list):
            for index, scene in enumerate(raw_timeline):
                if not isinstance(scene, dict):
                    continue
                asset_id = (
                    scene.get("asset_id")
                    or scene.get("assetId")
                    or scene.get("media_asset_id")
                    or scene.get("image_asset_id")
                )
                if not asset_id or asset_id not in asset_ids:
                    asset_id = media_assets[min(index, len(media_assets) - 1)]["id"]
                asset_type = next(
                    (asset["type"] for asset in media_assets if asset["id"] == asset_id),
                    AssetType.photo,
                )
                duration = int(
                    scene.get("duration_seconds")
                    or scene.get("duration")
                    or scene.get("durationSeconds")
                    or 5
                )
                duration = max(1, min(duration, 60))
                timeline.append(
                    TimelineScene(
                        type="video" if asset_type == AssetType.video else "photo",
                        duration_seconds=duration,
                        asset_id=asset_id,
                        caption=scene.get("caption") or scene.get("text"),
                        motion=scene.get("motion") or "slow_zoom",
                        transition=scene.get("transition") or "crossfade",
                    )
                )
        if len(timeline) == 1:
            for asset in media_assets:
                timeline.append(
                    TimelineScene(
                        type="video" if asset["type"] == AssetType.video else "photo",
                        duration_seconds=5,
                        asset_id=asset["id"],
                        caption=asset.get("caption") or asset.get("description") or asset.get("tag"),
                        motion="slow_zoom",
                        transition="crossfade",
                    )
                )
        timeline.append(TimelineScene(type="ending", duration_seconds=4, text="Thank you"))
        return timeline


class DeepSeekLLMProvider(OpenAICompatibleLLMProvider):
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = "https://api.deepseek.com",
        model: str = "deepseek-v4-pro",
        timeout_seconds: float = 60,
    ) -> None:
        super().__init__(
            api_key=api_key,
            base_url=base_url,
            model=model,
            timeout_seconds=timeout_seconds,
        )


class RawJsonLLMProvider:
    """Test helper for parser behavior."""

    def __init__(self, raw: str) -> None:
        self.raw = raw

    def complete(self, messages: list[dict], tools: list[dict]) -> AgentDecision:
        try:
            payload = json.loads(self.raw)
            return AgentDecision.model_validate(payload)
        except Exception as exc:
            raise LLMOutputParseError(f"Invalid LLM decision JSON: {exc}") from exc
