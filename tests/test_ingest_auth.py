# tests/test_ingest_auth.py
"""
Phase 0 — Ingest auth tests (Phase 7).

Run with: pytest tests/test_ingest_auth.py -v
"""
from __future__ import annotations

import os
import pytest
from httpx import AsyncClient, ASGITransport
from asgi_lifespan import LifespanManager


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


def _reload_app():
    """
    IMPORTANT:
    app.security imports `settings` at module import time.
    So when we change env vars in tests, we must reload:
      app.settings -> app.security -> app.main
    in this order, otherwise security keeps old settings.
    """
    import importlib
    import app.settings
    import app.security
    import app.main

    importlib.reload(app.settings)
    importlib.reload(app.security)
    importlib.reload(app.main)

    from app.main import app
    return app


# ---------------------------------------------------------------------------
# Dev mode (ingest_require_key=False) — should be open
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_ingest_dev_mode_no_key_required():
    """In dev mode (ingest_require_key=False), ingest should work without a key."""
    os.environ["OGX_ENV"] = "dev"
    os.environ["OGX_INGEST_REQUIRE_KEY"] = "false"
    os.environ.pop("OGX_INGEST_API_KEY", None)

    app = _reload_app()

    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.post("/ingest/galaxy", json={"galaxy": 1, "system": 1, "rows": []})
            assert resp.status_code != 401
            assert resp.status_code == 200


@pytest.mark.anyio
async def test_ingest_with_key_required_no_key_returns_401():
    """With ingest_require_key=True and a key configured, missing key → 401."""
    os.environ["OGX_ENV"] = "dev"
    os.environ["OGX_INGEST_REQUIRE_KEY"] = "true"
    os.environ["OGX_INGEST_API_KEY"] = "supersecretkey123"
    os.environ.setdefault("OGX_SECRET_KEY", "testsecretkey123")

    app = _reload_app()

    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.post("/ingest/galaxy", json={"galaxy": 1, "system": 1, "rows": []})
            assert resp.status_code == 401


@pytest.mark.anyio
async def test_ingest_wrong_key_returns_401():
    """Wrong API key → 401."""
    os.environ["OGX_ENV"] = "dev"
    os.environ["OGX_INGEST_REQUIRE_KEY"] = "true"
    os.environ["OGX_INGEST_API_KEY"] = "supersecretkey123"
    os.environ.setdefault("OGX_SECRET_KEY", "testsecretkey123")

    app = _reload_app()

    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.post(
                "/ingest/galaxy",
                json={"galaxy": 1, "system": 1, "rows": []},
                headers={"x-ogx-api-key": "wrongkey"},
            )
            assert resp.status_code == 401


@pytest.mark.anyio
async def test_ingest_correct_key_returns_200():
    """Correct API key → 200."""
    os.environ["OGX_ENV"] = "dev"
    os.environ["OGX_INGEST_REQUIRE_KEY"] = "true"
    os.environ["OGX_INGEST_API_KEY"] = "supersecretkey123"
    os.environ.setdefault("OGX_SECRET_KEY", "testsecretkey123")

    app = _reload_app()

    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.post(
                "/ingest/galaxy",
                json={"galaxy": 1, "system": 100, "rows": []},
                headers={"x-ogx-api-key": "supersecretkey123"},
            )
            assert resp.status_code == 200
            assert resp.json()["ok"] is True