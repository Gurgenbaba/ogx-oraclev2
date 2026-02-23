# app/db.py
from __future__ import annotations

from pathlib import Path
from typing import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .settings import settings


# ---------------------------------------------------------------------
# DATABASE URL
# ---------------------------------------------------------------------
APP_DIR = Path(__file__).resolve().parent
DB_PATH = (APP_DIR.parent / "ogx.db").resolve()  # project root

DEFAULT_SQLITE_URL = f"sqlite+aiosqlite:///{DB_PATH.as_posix()}"


def _normalize_db_url(raw: str | None) -> str:
    """
    Normalize DB URL into an ASYNC SQLAlchemy URL.

    Supported inputs:
    - (empty) -> local sqlite file
    - sqlite+aiosqlite:///...
    - sqlite:///...            -> upgraded to sqlite+aiosqlite
    - sqlite:///:memory:       -> upgraded to sqlite+aiosqlite
    - postgres://...           -> upgraded to postgresql+asyncpg
    - postgresql://...         -> upgraded to postgresql+asyncpg (unless already async)
    - postgresql+asyncpg://... -> kept as-is
    """
    if not raw:
        return DEFAULT_SQLITE_URL

    url = raw.strip()

    # SQLite (sync -> async)
    if url.startswith("sqlite:///") and not url.startswith("sqlite+aiosqlite:///"):
        url = "sqlite+aiosqlite:///" + url[len("sqlite:///") :]
    elif url.startswith("sqlite://") and not url.startswith("sqlite+aiosqlite://"):
        # handles sqlite:///:memory: and similar
        url = "sqlite+aiosqlite://" + url[len("sqlite://") :]

    # Postgres (sync -> asyncpg)
    if url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://") and not url.startswith("postgresql+asyncpg://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://") :]

    return url


DATABASE_URL = _normalize_db_url(settings.database_url)
IS_SQLITE = DATABASE_URL.startswith("sqlite+aiosqlite://")
IS_POSTGRES = DATABASE_URL.startswith("postgresql+asyncpg://")


# ---------------------------------------------------------------------
# ENGINE
# ---------------------------------------------------------------------
engine_kwargs: dict = {
    "echo": False,
    "future": True,
    "pool_pre_ping": True,   # avoids stale connections in prod
    "pool_recycle": 1800,    # helps long-running prod instances
}

# Driver-level connect args (separate from PRAGMA busy_timeout)
connect_args: dict = {}

if IS_SQLITE:
    # aiosqlite supports "timeout" which helps with locked DB cases
    connect_args["timeout"] = max(1, int(settings.sqlite_busy_timeout_ms // 1000))
else:
    # Postgres / others: keep a small, safe pool
    engine_kwargs.update(
        pool_size=5,
        max_overflow=10,
    )

if IS_POSTGRES:
    # Optional: set a conservative statement timeout (ms) to prevent runaway queries.
    # You can tune this later; keep it lenient enough for /export.
    connect_args["server_settings"] = {
        "application_name": "ogx-oracle",
        "statement_timeout": "15000",  # 15s
    }

if connect_args:
    engine_kwargs["connect_args"] = connect_args

engine = create_async_engine(DATABASE_URL, **engine_kwargs)


# ---------------------------------------------------------------------
# SQLITE PRAGMAS
# ---------------------------------------------------------------------
if IS_SQLITE:

    @event.listens_for(engine.sync_engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, connection_record):
        """
        SQLite pragmas for concurrency + reliability.

        WAL:
          - Allows concurrent readers while a writer is active.
        synchronous:
          - dev: NORMAL (speed)
          - prod: FULL (durability)
        foreign_keys:
          - must be ON for ON DELETE CASCADE to work
        busy_timeout:
          - waits on locks instead of failing fast
        """
        cursor = dbapi_connection.cursor()

        cursor.execute("PRAGMA journal_mode=WAL;")

        if settings.env == "prod":
            cursor.execute("PRAGMA synchronous=FULL;")
        else:
            cursor.execute("PRAGMA synchronous=NORMAL;")

        cursor.execute("PRAGMA foreign_keys=ON;")
        cursor.execute(f"PRAGMA busy_timeout={int(settings.sqlite_busy_timeout_ms)};")

        # Safe performance helpers (no correctness risk)
        cursor.execute("PRAGMA temp_store=MEMORY;")

        cursor.close()


# ---------------------------------------------------------------------
# SESSION FACTORY
# ---------------------------------------------------------------------
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency: yields an AsyncSession.
    Ensures sessions are always closed.
    """
    async with AsyncSessionLocal() as session:
        yield session