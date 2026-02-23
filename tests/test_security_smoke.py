# tests/test_security_smoke.py
"""
Security smoke tests — fast, no DB writes needed for most checks.
Run: pytest tests/test_security_smoke.py -v
"""
from __future__ import annotations

import io
import pytest
from httpx import AsyncClient, ASGITransport
from asgi_lifespan import LifespanManager


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module")
async def client():
    """
    IMPORTANT:
    Some httpx/ASGITransport versions don't support lifespan="on".
    We use LifespanManager to ensure FastAPI startup runs (create_all).
    """
    from app.main import app

    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


# ---------------------------------------------------------------------------
# Basic reachability
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_root_200(client):
    r = await client.get("/")
    assert r.status_code == 200


@pytest.mark.anyio
async def test_healthz_200(client):
    r = await client.get("/healthz")
    assert r.status_code == 200


@pytest.mark.anyio
async def test_import_ui_200(client):
    r = await client.get("/import-ui")
    assert r.status_code == 200


@pytest.mark.anyio
async def test_galaxy_200(client):
    r = await client.get("/galaxy")
    assert r.status_code == 200


@pytest.mark.anyio
async def test_player_redirect_if_not_found(client):
    r = await client.get("/player/nonexistent_xyz_abc", follow_redirects=False)
    assert r.status_code in (404, 302, 303, 307, 200)


# ---------------------------------------------------------------------------
# CSRF enforcement
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_post_player_add_without_csrf_403():
    """POST without CSRF cookie → 403 (Phase 1)"""
    from app.main import app

    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.post(
                "/player/add",
                data={"player_name": "TestPlayer"},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            assert r.status_code == 403


@pytest.mark.anyio
async def test_post_import_without_csrf_header_403():
    """POST /import without x-csrf-token header → 403 (Phase 1)"""
    from app.main import app

    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.post(
                "/import",
                files={"file": ("test.csv", io.BytesIO(b"a,b\n1,2\n"), "text/csv")},
            )
            assert r.status_code == 403


@pytest.mark.anyio
async def test_post_import_with_csrf_header_passes():
    """POST /import with valid x-csrf-token header → not 403 (Phase 1)"""
    from app.main import app

    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            get_resp = await c.get("/import-ui")
            assert get_resp.status_code == 200

            csrf_token = c.cookies.get("ogx_csrf")
            assert csrf_token, f"CSRF cookie should be set after GET. Cookies: {dict(c.cookies)}"

            r = await c.post(
                "/import",
                files={"file": ("test.csv", io.BytesIO(b"galaxy,system,position,player\n"), "text/csv")},
                headers={"x-csrf-token": csrf_token},
            )

            if r.status_code == 403:
                body = r.json()
                assert body.get("error") not in ("csrf_missing_cookie", "csrf_invalid"), \
                    f"CSRF validation should pass but got: {body}"


# ---------------------------------------------------------------------------
# Security headers
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_security_headers_present(client):
    r = await client.get("/")
    assert "x-frame-options" in r.headers
    assert "x-content-type-options" in r.headers
    assert "content-security-policy" in r.headers


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_rate_limit_import_endpoint():
    """
    /import has per-endpoint limit of 5 req/window.
    Need CSRF cookie so requests pass CSRF check and reach rate limiter.
    """
    from app.main import app

    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            await c.get("/import-ui")
            csrf_token = c.cookies.get("ogx_csrf")
            assert csrf_token, "Need CSRF cookie to test rate limiting"

            statuses = []
            for _ in range(8):
                r = await c.post(
                    "/import",
                    files={"file": ("t.csv", io.BytesIO(b"a,b\n"), "text/csv")},
                    headers={"x-csrf-token": csrf_token},
                )
                statuses.append(r.status_code)

            assert 429 in statuses, f"Expected 429 after exceeding /import rate limit (5/window), got: {statuses}"