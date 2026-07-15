from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.settings import Settings, get_settings
from app.db_models import Base, VideoRenderProjectRow


def create_db_engine(settings: Settings | None = None) -> Engine:
    resolved = settings or get_settings()
    url = resolved.effective_database_url
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, connect_args=connect_args, pool_pre_ping=True)


def create_schema(settings: Settings | None = None) -> None:
    engine = create_db_engine(settings)
    Base.metadata.create_all(engine)
    _repair_sqlite_project_schema(engine)


def _repair_sqlite_project_schema(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return

    inspector = inspect(engine)
    if "video_render_projects" not in inspector.get_table_names():
        return

    columns = {column["name"]: column for column in inspector.get_columns("video_render_projects")}
    expected_columns = {
        "invite_code",
        "couple_names",
        "wedding_date",
        "location",
        "package_type",
        "status",
    }
    spec_id_is_required = bool(columns.get("spec_id", {}).get("nullable") is False)
    if expected_columns.issubset(columns) and not spec_id_is_required:
        with engine.begin() as connection:
            connection.execute(text("DROP TABLE IF EXISTS video_render_projects_legacy"))
        return

    with engine.begin() as connection:
        connection.execute(text("DROP TABLE IF EXISTS video_render_projects_legacy"))
        connection.execute(text("ALTER TABLE video_render_projects RENAME TO video_render_projects_legacy"))
        connection.execute(text("DROP INDEX IF EXISTS ix_video_render_projects_spec_id"))
        connection.execute(text("DROP INDEX IF EXISTS ix_video_render_projects_invite_code"))
        connection.execute(text("DROP INDEX IF EXISTS ix_video_render_projects_status"))
        connection.execute(text("DROP INDEX IF EXISTS ix_video_render_projects_entitlement_status"))
        VideoRenderProjectRow.__table__.create(connection)
        connection.execute(
            text(
                """
                INSERT INTO video_render_projects (
                    id,
                    spec_id,
                    invite_code,
                    couple_names,
                    wedding_date,
                    location,
                    package_type,
                    status,
                    entitlement_status,
                    payload,
                    created_at,
                    updated_at
                )
                SELECT
                    id,
                    spec_id,
                    COALESCE(
                        json_extract(payload, '$.invite_code'),
                        UPPER(SUBSTR(REPLACE(id, '-', ''), 1, 6))
                    ),
                    COALESCE(json_extract(payload, '$.couple_names'), 'Our Wedding'),
                    json_extract(payload, '$.wedding_date'),
                    json_extract(payload, '$.location'),
                    COALESCE(json_extract(payload, '$.package_type'), 'guest_cam_recap'),
                    COALESCE(json_extract(payload, '$.status'), 'active'),
                    COALESCE(entitlement_status, json_extract(payload, '$.entitlement_status'), 'none'),
                    payload,
                    created_at,
                    updated_at
                FROM video_render_projects_legacy
                """
            )
        )
        connection.execute(text("DROP TABLE video_render_projects_legacy"))


def get_db_session() -> Generator[Session, None, None]:
    settings = get_settings()
    engine = create_db_engine(settings)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as session:
        yield session
