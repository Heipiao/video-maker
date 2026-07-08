from datetime import datetime, timezone
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class AgentMessageRole(StrEnum):
    system = "system"
    user = "user"
    assistant = "assistant"
    tool = "tool"


class AgentMessage(BaseModel):
    role: AgentMessageRole
    content: str
    tool_call: dict[str, Any] | None = None
    tool_result: dict[str, Any] | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AgentContextSection(BaseModel):
    name: str
    content: str


class AgentSession(BaseModel):
    id: str
    system_prompt: str
    asset_ids: list[str] = Field(default_factory=list)
    history: list[AgentMessage] = Field(default_factory=list)
    current_spec_id: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def touch(self) -> None:
        self.updated_at = datetime.now(timezone.utc)


class AgentRunStatus(StrEnum):
    completed = "completed"
    failed = "failed"


class AgentRun(BaseModel):
    id: str
    session_id: str
    user_message: str
    assistant_message: str | None = None
    tool_call: dict[str, Any] | None = None
    tool_result: dict[str, Any] | None = None
    context_sections: list[AgentContextSection] = Field(default_factory=list)
    spec_id: str | None = None
    render_job_id: str | None = None
    status: AgentRunStatus = AgentRunStatus.completed
    error: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
