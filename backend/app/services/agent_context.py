import json
from dataclasses import dataclass

from app.models.agent import AgentContextSection, AgentSession
from app.models.asset import Asset
from app.models.spec import WeddingVideoSpec


@dataclass
class AgentContextBuilder:
    max_history_messages: int = 10
    max_message_chars: int = 1200

    def build_messages(
        self,
        session: AgentSession,
        assets: list[Asset],
        user_message: str,
        current_spec: WeddingVideoSpec | None = None,
    ) -> list[dict]:
        sections = self.build_sections(session, assets, user_message, current_spec)
        system_content = "\n\n".join(
            section.content
            for section in sections
            if section.name not in {"history", "user_message"} and section.content
        )
        messages = [{"role": "system", "content": system_content}]
        for message in session.history[-self.max_history_messages :]:
            if message.role in {"user", "assistant"}:
                messages.append(
                    {
                        "role": message.role.value,
                        "content": message.content[: self.max_message_chars],
                    }
                )
        messages.append({"role": "user", "content": user_message})
        return messages

    def build_sections(
        self,
        session: AgentSession,
        assets: list[Asset],
        user_message: str,
        current_spec: WeddingVideoSpec | None = None,
    ) -> list[AgentContextSection]:
        history_payload = [
            {"role": message.role.value, "content": message.content[: self.max_message_chars]}
            for message in session.history[-self.max_history_messages :]
            if message.role in {"user", "assistant", "tool", "system"}
        ]
        sections = [
            AgentContextSection(name="system_prompt", content=session.system_prompt),
            AgentContextSection(name="resources", content=self._resource_summary(assets)),
            AgentContextSection(
                name="history",
                content=json.dumps(history_payload, ensure_ascii=False, indent=2),
            ),
            AgentContextSection(
                name="current_spec",
                content=self._current_spec_summary(current_spec) or "null",
            ),
            AgentContextSection(name="tool", content=self._tool_instruction()),
            AgentContextSection(name="output_contract", content=self._output_contract()),
            AgentContextSection(name="user_message", content=user_message),
        ]
        return sections

    def _resource_summary(self, assets: list[Asset]) -> str:
        payload = [
            {
                "id": asset.id,
                "type": asset.type,
                "url": str(asset.url),
                "tag": asset.tag,
                "description": asset.description,
                "caption": asset.caption,
                "analysis_status": asset.analysis_status,
                "analysis": asset.analysis.model_dump(mode="json"),
            }
            for asset in assets
        ]
        return "资源列表:\n" + json.dumps(payload, ensure_ascii=False, indent=2)

    def _current_spec_summary(self, spec: WeddingVideoSpec | None) -> str:
        if spec is None:
            return ""
        return "当前 VideoSpec:\n" + spec.model_dump_json(indent=2)

    def _tool_instruction(self) -> str:
        return (
            "唯一可用工具: generate_video\n"
            "用途: 保存最终 VideoSpec，并创建 manifest render job。\n"
            "参数: {\"video_spec\": <完整 VideoSpec JSON>}。\n"
            "不要调用其他工具。"
        )

    def _output_contract(self) -> str:
        return (
            "输出必须是 JSON，不要 markdown，不要额外文字。格式:\n"
            "{\n"
            "  \"assistant_message\": \"给用户看的简短说明\",\n"
            "  \"video_spec\": <完整 VideoSpec JSON 或 null>,\n"
            "  \"should_call_generate_video\": true\n"
            "}\n"
            "如果素材不足以生成视频，should_call_generate_video=false，并解释缺什么。\n"
            "video_spec 必须严格使用以下字段，不要输出 resolution/scenes/clips 这类自定义结构:\n"
            "{\n"
            "  \"id\": \"任意唯一字符串\",\n"
            "  \"template_id\": \"classic_wedding\",\n"
            "  \"title\": \"视频标题\",\n"
            "  \"aspect_ratio\": \"16:9 或 9:16 或 1:1\",\n"
            "  \"duration_seconds\": 18,\n"
            "  \"assets\": <完整资源列表数组，必须沿用资源列表里的 id/type/url/tag/description/analysis>,\n"
            "  \"music_asset_id\": \"音乐 asset_id 或 null\",\n"
            "  \"style\": {\n"
            "    \"font\": \"Playfair Display\",\n"
            "    \"primary_color\": \"#C9A86A\",\n"
            "    \"transition\": \"crossfade\",\n"
            "    \"photo_motion\": \"slow_zoom\",\n"
            "    \"caption_position\": \"bottom\",\n"
            "    \"music_volume\": 0.7\n"
            "  },\n"
            "  \"timeline\": [\n"
            "    {\"type\":\"title\",\"duration_seconds\":4,\"text\":\"标题文案\"},\n"
            "    {\"type\":\"photo\",\"duration_seconds\":5,\"asset_id\":\"图片素材 id\",\"caption\":\"字幕\",\"motion\":\"slow_zoom\",\"transition\":\"crossfade\"},\n"
            "    {\"type\":\"ending\",\"duration_seconds\":4,\"text\":\"结尾文案\"}\n"
            "  ]\n"
            "}\n"
            "duration_seconds 必须等于 timeline 中每段 duration_seconds 之和。"
        )
