from uuid import uuid4

from app.models.agent import AgentMessage, AgentMessageRole, AgentRun, AgentRunStatus, AgentSession
from app.models.spec import WeddingVideoSpec
from app.schemas import CreateAgentSessionRequest, SendAgentMessageRequest
from app.services.agent_context import AgentContextBuilder
from app.services.agent_llm import LLMProvider, MockLLMProvider
from app.services.agent_store import FileAgentRunStore, FileAgentSessionStore
from app.services.agent_tool import GenerateVideoTool
from app.services.asset_store import FileAssetStore
from app.services.spec_store import FileSpecStore, SpecNotFoundError


class AgentExecutionError(Exception):
    pass


class AgentService:
    def __init__(
        self,
        session_store: FileAgentSessionStore,
        run_store: FileAgentRunStore,
        asset_store: FileAssetStore,
        spec_store: FileSpecStore,
        generate_video_tool: GenerateVideoTool,
        llm_provider: LLMProvider | None = None,
        context_builder: AgentContextBuilder | None = None,
    ) -> None:
        self.session_store = session_store
        self.run_store = run_store
        self.asset_store = asset_store
        self.spec_store = spec_store
        self.generate_video_tool = generate_video_tool
        self.llm_provider = llm_provider or MockLLMProvider()
        self.context_builder = context_builder or AgentContextBuilder()

    def create_session(self, request: CreateAgentSessionRequest) -> AgentSession:
        for asset_id in request.asset_ids:
            self.asset_store.get(asset_id)
        history = []
        if request.system_prompt.strip():
            history.append(
                AgentMessage(role=AgentMessageRole.system, content=request.system_prompt.strip())
            )
        session = AgentSession(
            id=str(uuid4()),
            system_prompt=request.system_prompt,
            asset_ids=request.asset_ids,
            history=history,
        )
        return self.session_store.save(session)

    def get_session(self, session_id: str) -> AgentSession:
        return self.session_store.get(session_id)

    def run_message(self, session_id: str, request: SendAgentMessageRequest) -> tuple[AgentSession, AgentRun]:
        session = self.session_store.get(session_id)
        assets = [self.asset_store.get(asset_id) for asset_id in session.asset_ids]
        current_spec = self._get_current_spec(session)
        context_sections = self.context_builder.build_sections(
            session=session,
            assets=assets,
            current_spec=current_spec,
            user_message=request.message,
        )
        messages = self.context_builder.build_messages(
            session=session,
            assets=assets,
            current_spec=current_spec,
            user_message=request.message,
        )
        run = AgentRun(id=str(uuid4()), session_id=session.id, user_message=request.message)
        run.context_sections = context_sections
        session.history.append(AgentMessage(role=AgentMessageRole.user, content=request.message))

        try:
            decision = self.llm_provider.complete(messages, [self.generate_video_tool.definition()])
            run.assistant_message = decision.assistant_message
            session.history.append(
                AgentMessage(role=AgentMessageRole.assistant, content=decision.assistant_message)
            )

            if decision.should_call_generate_video:
                if decision.video_spec is None:
                    raise AgentExecutionError("LLM requested generate_video without video_spec")
                tool_call = {
                    "name": self.generate_video_tool.name,
                    "arguments": {"video_spec": decision.video_spec.model_dump(mode="json")},
                }
                run.tool_call = tool_call
                tool_result = self.generate_video_tool.call(decision.video_spec)
                run.tool_result = tool_result
                run.spec_id = tool_result["spec_id"]
                run.render_job_id = tool_result["render_job_id"]
                session.current_spec_id = tool_result["spec_id"]
                session.history.append(
                    AgentMessage(
                        role=AgentMessageRole.tool,
                        content="generate_video completed",
                        tool_call=tool_call,
                        tool_result=tool_result,
                    )
                )
        except Exception as exc:
            run.status = AgentRunStatus.failed
            run.error = str(exc)
            session.history.append(
                AgentMessage(
                    role=AgentMessageRole.tool,
                    content=f"agent execution failed: {exc}",
                    tool_result={"error": str(exc)},
                )
            )

        session.touch()
        self.session_store.save(session)
        self.run_store.save(run)
        return session, run

    def _get_current_spec(self, session: AgentSession) -> WeddingVideoSpec | None:
        if not session.current_spec_id:
            return None
        try:
            return self.spec_store.get(session.current_spec_id)
        except SpecNotFoundError:
            return None
