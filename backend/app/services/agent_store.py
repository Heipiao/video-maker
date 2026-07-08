from app.models.agent import AgentRun, AgentSession
from app.services.file_store import JsonFileStore, RecordNotFoundError

AgentSessionNotFoundError = RecordNotFoundError
AgentRunNotFoundError = RecordNotFoundError


class FileAgentSessionStore(JsonFileStore[AgentSession]):
    def __init__(self, agent_sessions_dir) -> None:
        super().__init__(agent_sessions_dir, AgentSession)


class FileAgentRunStore(JsonFileStore[AgentRun]):
    def __init__(self, agent_runs_dir) -> None:
        super().__init__(agent_runs_dir, AgentRun)
