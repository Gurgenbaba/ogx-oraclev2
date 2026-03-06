# app/main.py
from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple, Any
from collections import defaultdict

import csv
import io
import re as _re
import hmac
import secrets

from fastapi import FastAPI, Request, Form, UploadFile, File, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse, PlainTextResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from sqlalchemy import select, func, delete, text, update
from sqlalchemy.orm import selectinload

# FIX: removed duplicate absolute import (from app.db import engine / from app.models import Base).
# Only relative imports below.
from .db import engine, AsyncSessionLocal, IS_SQLITE, IS_POSTGRES
from .models import Base, Player, Colony, GalaxyScan, User
from .prestige import (
    handle_galaxy_scan as prestige_scan,
    handle_daily_login as prestige_login,
    get_prestige_summary,
    get_leaderboard as prestige_leaderboard,
    seed_achievements,
)
from .settings import settings
from .i18n import get_lang, make_translator, get_translations_js, get_lang_switcher_data, SUPPORTED, LANG_COOKIE
from .security import (
    CsrfMiddleware,
    MaxSizeMiddleware,
    RequestIdLoggingMiddleware,
    SecurityHeadersMiddleware,
    SimpleRateLimitMiddleware,
    require_ingest_auth,
    require_jwt_user,
    hash_password,
    verify_password,
    create_access_token,
    CSRF_COOKIE,
)

APP_DIR = Path(__file__).resolve().parent

# Templates MUST exist before lifespan uses them
templates = Jinja2Templates(directory=str(APP_DIR / "templates"))
templates.env.globals["now_utc"] = lambda: datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Lifespan (replaces deprecated @app.on_event)
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Dev: create tables automatically (convenience).
    Prod: never auto-create schema. Only verify DB connectivity.
    """
    if settings.env == "dev":
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            # Bridge tables
            # Note: ALTER TABLE done in separate conn below to isolate failures
            # Bridge tables — dialect-aware
            _lc_pg = """
                CREATE TABLE IF NOT EXISTS link_codes (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL UNIQUE,
                    code TEXT NOT NULL,
                    created_at TIMESTAMP NOT NULL,
                    used BOOLEAN NOT NULL DEFAULT FALSE,
                    game_player_id INTEGER,
                    game_username TEXT,
                    verified_at TIMESTAMP
                )"""
            _lc_sq = """
                CREATE TABLE IF NOT EXISTS link_codes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL UNIQUE,
                    code TEXT NOT NULL,
                    created_at TIMESTAMP NOT NULL,
                    used BOOLEAN NOT NULL DEFAULT 0,
                    game_player_id INTEGER,
                    game_username TEXT,
                    verified_at TIMESTAMP
                )"""
            _la_pg = """
                CREATE TABLE IF NOT EXISTS linked_accounts (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL UNIQUE,
                    game_player_id INTEGER NOT NULL,
                    game_username TEXT NOT NULL,
                    linked_at TIMESTAMP NOT NULL
                )"""
            _la_sq = """
                CREATE TABLE IF NOT EXISTS linked_accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL UNIQUE,
                    game_player_id INTEGER NOT NULL,
                    game_username TEXT NOT NULL,
                    linked_at TIMESTAMP NOT NULL
                )"""
            await conn.execute(text(_lc_pg if IS_POSTGRES else _lc_sq))
            await conn.execute(text(_la_pg if IS_POSTGRES else _la_sq))
            _sc_pg = """
                CREATE TABLE IF NOT EXISTS smuggler_codes (
                    id SERIAL PRIMARY KEY,
                    code TEXT NOT NULL UNIQUE,
                    reward_type TEXT NOT NULL DEFAULT 'prestige_xp',
                    reward_value INTEGER NOT NULL DEFAULT 100,
                    badge_id TEXT,
                    max_uses INTEGER NOT NULL DEFAULT 1,
                    uses_count INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL,
                    expires_at TIMESTAMP,
                    created_by TEXT
                )"""
            _sc_sq = """
                CREATE TABLE IF NOT EXISTS smuggler_codes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT NOT NULL UNIQUE,
                    reward_type TEXT NOT NULL DEFAULT 'prestige_xp',
                    reward_value INTEGER NOT NULL DEFAULT 100,
                    badge_id TEXT,
                    max_uses INTEGER NOT NULL DEFAULT 1,
                    uses_count INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL,
                    expires_at TIMESTAMP,
                    created_by TEXT
                )"""
            _scr_pg = """
                CREATE TABLE IF NOT EXISTS smuggler_code_redemptions (
                    id SERIAL PRIMARY KEY,
                    code_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    redeemed_at TIMESTAMP NOT NULL,
                    reward_type TEXT NOT NULL,
                    reward_value INTEGER NOT NULL,
                    UNIQUE (code_id, user_id)
                )"""
            _scr_sq = """
                CREATE TABLE IF NOT EXISTS smuggler_code_redemptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    redeemed_at TIMESTAMP NOT NULL,
                    reward_type TEXT NOT NULL,
                    reward_value INTEGER NOT NULL,
                    UNIQUE (code_id, user_id)
                )"""
            await conn.execute(text(_sc_pg if IS_POSTGRES else _sc_sq))
            await conn.execute(text(_scr_pg if IS_POSTGRES else _scr_sq))
        async with AsyncSessionLocal() as db:
            await seed_achievements(db)
    else:
        # prod: verify DB reachable, then ensure schema exists
        # Step 1: basic connectivity + SQLAlchemy models
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
            await conn.run_sync(Base.metadata.create_all)

        # Step 2: each ALTER TABLE in its OWN transaction
        # PostgreSQL: an exception inside a transaction poisons ALL subsequent statements.
        # Fix: use a fresh connection+transaction per ALTER so failures are isolated.
        for col, typ in [("debris_metal", "INTEGER"), ("debris_crystal", "INTEGER")]:
            try:
                async with engine.begin() as conn:
                    await conn.execute(text(
                        f"ALTER TABLE colonies ADD COLUMN {col} {typ} NOT NULL DEFAULT 0"
                    ))
            except Exception:
                pass  # Column already exists — safe to ignore

        # Step 3: bridge tables — each in its own transaction
        _bridge_tables_pg = [
            """CREATE TABLE IF NOT EXISTS link_codes (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE,
                code TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL,
                used BOOLEAN NOT NULL DEFAULT FALSE,
                game_player_id INTEGER,
                game_username TEXT,
                verified_at TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS linked_accounts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                server_id TEXT NOT NULL DEFAULT 'universum-1',
                game_player_id INTEGER NOT NULL,
                game_username TEXT NOT NULL,
                linked_at TIMESTAMP NOT NULL,
                UNIQUE (user_id, server_id)
            )""",
            """CREATE TABLE IF NOT EXISTS smuggler_codes (
                id SERIAL PRIMARY KEY,
                code TEXT NOT NULL UNIQUE,
                reward_type TEXT NOT NULL DEFAULT 'prestige_xp',
                reward_value INTEGER NOT NULL DEFAULT 100,
                badge_id TEXT,
                max_uses INTEGER NOT NULL DEFAULT 1,
                uses_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL,
                expires_at TIMESTAMP,
                created_by TEXT
            )""",
            """CREATE TABLE IF NOT EXISTS smuggler_code_redemptions (
                id SERIAL PRIMARY KEY,
                code_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                redeemed_at TIMESTAMP NOT NULL,
                reward_type TEXT NOT NULL,
                reward_value INTEGER NOT NULL,
                UNIQUE (code_id, user_id)
            )""",
            """CREATE TABLE IF NOT EXISTS smuggler_found_codes (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                server_id TEXT NOT NULL DEFAULT 'uni1',
                code TEXT NOT NULL,
                level INTEGER NOT NULL DEFAULT 1,
                found_at TIMESTAMP NOT NULL,
                expo_date TIMESTAMP,
                prestige_xp_awarded INTEGER NOT NULL DEFAULT 0,
                UNIQUE (user_id, code)
            )""",
        ]
        _bridge_tables_sq = [
            """CREATE TABLE IF NOT EXISTS link_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE,
                code TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL,
                used BOOLEAN NOT NULL DEFAULT 0,
                game_player_id INTEGER,
                game_username TEXT,
                verified_at TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS linked_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                server_id TEXT NOT NULL DEFAULT 'universum-1',
                game_player_id INTEGER NOT NULL,
                game_username TEXT NOT NULL,
                linked_at TIMESTAMP NOT NULL,
                UNIQUE (user_id, server_id)
            )""",
            """CREATE TABLE IF NOT EXISTS smuggler_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL UNIQUE,
                reward_type TEXT NOT NULL DEFAULT 'prestige_xp',
                reward_value INTEGER NOT NULL DEFAULT 100,
                badge_id TEXT,
                max_uses INTEGER NOT NULL DEFAULT 1,
                uses_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL,
                expires_at TIMESTAMP,
                created_by TEXT
            )""",
            """CREATE TABLE IF NOT EXISTS smuggler_code_redemptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                redeemed_at TIMESTAMP NOT NULL,
                reward_type TEXT NOT NULL,
                reward_value INTEGER NOT NULL,
                UNIQUE (code_id, user_id)
            )""",
            """CREATE TABLE IF NOT EXISTS smuggler_found_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                server_id TEXT NOT NULL DEFAULT 'uni1',
                code TEXT NOT NULL,
                level INTEGER NOT NULL DEFAULT 1,
                found_at TIMESTAMP NOT NULL,
                expo_date TIMESTAMP,
                prestige_xp_awarded INTEGER NOT NULL DEFAULT 0,
                UNIQUE (user_id, code)
            )""",
        ]
        tables = _bridge_tables_pg if IS_POSTGRES else _bridge_tables_sq
        for stmt in tables:
            try:
                async with engine.begin() as conn:
                    await conn.execute(text(stmt))
            except Exception:
                pass  # Table already exists

        async with AsyncSessionLocal() as db:
            await seed_achievements(db)

    yield


app = FastAPI(title="OGX Oracle", lifespan=lifespan)

# Static
app.mount("/static", StaticFiles(directory=str(APP_DIR / "static")), name="static")

# CORS:
# NOTE: GM_xmlhttpRequest does not require CORS.
# Keep minimal anyway for any browser-based fetch.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://uni1.playogx.com", "http://uni1.playogx.com"],
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["content-type", "x-ogx-api-key", "authorization", "x-csrf-token"],
)

# Security middlewares (order matters!)
# Goal: RequestId + SecurityHeaders should be present even for early rejects (413/429/403).
# Starlette middleware stack runs "outermost" last-added.
app.add_middleware(MaxSizeMiddleware)
app.add_middleware(SimpleRateLimitMiddleware)
app.add_middleware(CsrfMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestIdLoggingMiddleware)

# FIX: Removed @app.on_event("startup") block — it was deprecated, conflicted with
# lifespan(), and bypassed the intentional prod guard (ran create_all in prod).


# ---------------------------------------------------------------------------
# Source constants
# ---------------------------------------------------------------------------
SRC_MANUAL_ADD = "manual_add"
SRC_MANUAL_EDIT = "manual_edit"
SRC_IMPORT = "import"
SRC_HELPER = "helper"

# Default planet name (English)
DEFAULT_PLANET_NAME = "Colony"


def _template(request: Request, name: str, ctx: dict) -> HTMLResponse:
    """
    Always provide csrf_token and i18n to templates.
    """
    csrf_token = getattr(request.state, "csrf_token", None) or request.cookies.get(CSRF_COOKIE) or ""
    lang = get_lang(request)
    base = {
        "request":   request,
        "csrf_token": csrf_token,
        "t":         make_translator(lang),
        "lang":      lang,
        "i18n_js":   get_translations_js(lang),
        "lang_switcher": get_lang_switcher_data(lang),
        "lang_switcher": get_lang_switcher_data(lang),
        "settings":  settings,
    }
    base.update(ctx)
    return templates.TemplateResponse(request, name, base)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _utcnow_naive() -> datetime:
    """Single source of truth: store & compute times as naive UTC."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _norm_name(name: str) -> str:
    return " ".join((name or "").strip().split())


_PLAYER_STATUS_RE = _re.compile(r"\s*\(\s*[vViIn](?:\s+[vViIn])*\s*\)\s*$")


def _norm_player_name(name: str) -> str:
    name = _norm_name(name)
    return _PLAYER_STATUS_RE.sub("", name).strip()


def _to_bool(v: Any) -> bool:
    if v is None:
        return False
    s = str(v).strip().lower()
    return s in ("1", "true", "yes", "y", "on", "x", "✅")


def _to_int_or_none(v: Any) -> Optional[int]:
    if v is None:
        return None
    s = str(v).strip()
    if s == "":
        return None
    try:
        return int(s)
    except ValueError:
        return None


def _norm_username(u: str) -> str:
    """
    Normalize username consistently (DB expects this form).
    """
    return (u or "").strip().lower()


async def _delete_player_if_no_colonies(db, player_id: int) -> bool:
    res = await db.execute(select(func.count(Colony.id)).where(Colony.player_id == player_id))
    cnt = int(res.scalar() or 0)
    if cnt == 0:
        await db.execute(delete(Player).where(Player.id == player_id))
        return True
    return False


async def get_player_by_name(name: str) -> Optional[Player]:
    name = _norm_name(name)
    async with AsyncSessionLocal() as db:
        q = select(Player).where(Player.name == name).options(selectinload(Player.colonies))
        res = await db.execute(q)
        return res.scalar_one_or_none()


async def get_or_create_player(db, name: str) -> Tuple[Player, bool]:
    name = _norm_name(name)
    res = await db.execute(select(Player).where(Player.name == name))
    p = res.scalar_one_or_none()
    if p:
        return p, False
    p = Player(name=name)
    db.add(p)
    await db.flush()
    return p, True


def max_planets_for_astro(astro: Optional[int]) -> int:
    if astro is None:
        return 1
    a = int(astro)
    if a < 0:
        return 1
    return max(1, a // 2)


def _sort_colonies(colonies: list[Colony]) -> list[Colony]:
    return sorted(colonies, key=lambda c: (c.galaxy, c.system, c.position))


async def _ensure_single_main(db, player_id: int, main_colony_id: int) -> None:
    """
    FIX: Use targeted UPDATE instead of loading all colonies into memory.
    Only updates rows where is_main needs to change, avoiding unnecessary bulk UPDATEs.
    """
    # Clear is_main on all OTHER colonies for this player
    await db.execute(
        update(Colony)
        .where(Colony.player_id == player_id, Colony.id != main_colony_id)
        .values(is_main=False)
    )
    # Ensure the target colony is marked main
    await db.execute(
        update(Colony)
        .where(Colony.id == main_colony_id)
        .values(is_main=True)
    )


async def _upsert_galaxy_scan(db, *, galaxy: int, system: int, scanned_at: datetime, planets_found: int) -> None:
    """
    Dialect-safe UPSERT for GalaxyScan.
    - SQLite: uses sqlite dialect insert..on_conflict_do_update
    - Postgres: uses postgres dialect insert..on_conflict_do_update
    - Other: fallback select/update

    FIX: db.bind is always None in SQLAlchemy 2.x async sessions.
    Use IS_SQLITE / IS_POSTGRES from db.py instead.
    """
    if IS_SQLITE:
        from sqlalchemy.dialects.sqlite import insert as _ins

        stmt = (
            _ins(GalaxyScan)
            .values(galaxy=galaxy, system=system, scanned_at=scanned_at, planets_found=planets_found)
            .on_conflict_do_update(
                index_elements=["galaxy", "system"],
                set_={"scanned_at": scanned_at, "planets_found": planets_found},
            )
        )
        await db.execute(stmt)
        return

    if IS_POSTGRES:
        from sqlalchemy.dialects.postgresql import insert as _ins

        stmt = (
            _ins(GalaxyScan)
            .values(galaxy=galaxy, system=system, scanned_at=scanned_at, planets_found=planets_found)
            .on_conflict_do_update(
                index_elements=["galaxy", "system"],
                set_={"scanned_at": scanned_at, "planets_found": planets_found},
            )
        )
        await db.execute(stmt)
        return

    # Generic ORM fallback (other dialects)
    res = await db.execute(select(GalaxyScan).where(GalaxyScan.galaxy == galaxy, GalaxyScan.system == system))
    row = res.scalar_one_or_none()
    if row:
        row.scanned_at = scanned_at
        row.planets_found = planets_found
    else:
        db.add(GalaxyScan(galaxy=galaxy, system=system, scanned_at=scanned_at, planets_found=planets_found))


# ---------------------------------------------------------------------------
# Health / Readiness
# ---------------------------------------------------------------------------

@app.get("/api/prestige")
async def api_prestige(request: Request):
    """JSON prestige summary + leaderboard for the current JWT user."""
    u, err = await _require_user_for_write(request)
    if err:
        return JSONResponse({"ok": False, "error": "unauthorized"}, status_code=401)
    async with AsyncSessionLocal() as db:
        summary = await get_prestige_summary(db, int(u.id))
        board   = await prestige_leaderboard(db, limit=20)
        # Enrich leaderboard with usernames + is_current_user flag
        for entry in board:
            res = await db.execute(select(User).where(User.id == entry["user_id"]))
            usr = res.scalar_one_or_none()
            entry["username"]        = usr.username if usr else f"user_{entry['user_id']}"
            entry["is_current_user"] = (entry["user_id"] == int(u.id))
        return JSONResponse({"ok": True, **summary, "leaderboard": board})


@app.get("/api/leaderboard")
async def api_leaderboard(request: Request):
    """Top 20 leaderboard — public."""
    async with AsyncSessionLocal() as db:
        board = await prestige_leaderboard(db, limit=20)
        # Enrich with usernames
        for entry in board:
            res = await db.execute(select(User).where(User.id == entry["user_id"]))
            usr = res.scalar_one_or_none()
            entry["username"] = usr.username if usr else f"user_{entry['user_id']}"
        return JSONResponse({"ok": True, "leaderboard": board})


@app.get("/static/i18n_data.js", include_in_schema=False)
async def i18n_data_js(request: Request):
    """Serve window.I18N as a JS file — CSP-safe alternative to inline <script>."""
    lang = get_lang(request)
    translations = get_translations_js(lang)
    import json
    content = "window.I18N = " + json.dumps(translations, ensure_ascii=False) + ";"
    from fastapi.responses import Response
    return Response(
        content=content,
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.get("/readyz")
async def readyz():
    """
    Readiness = DB reachable.
    Useful for prod deploys (Railway/Render/K8s).
    """
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"ok": False, "error": "db_unreachable", "detail": str(e)}, status_code=503)


# ---------------------------------------------------------------------------
# AUTH API (JWT)
# ---------------------------------------------------------------------------

async def _read_json_or_form(request: Request) -> dict:
    """Accept both application/json and application/x-www-form-urlencoded (mobile fix)."""
    ctype = (request.headers.get("content-type") or "").lower()
    if "application/json" in ctype:
        try:
            data = await request.json()
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}
    try:
        form = await request.form()
        return dict(form)
    except Exception:
        return {}

@app.post("/auth/register")
async def auth_register(request: Request):
    if not settings.allow_registration:
        return JSONResponse({"ok": False, "error": "registration_disabled"}, status_code=403)

    payload = await _read_json_or_form(request)
    username = _norm_username(str(payload.get("username") or ""))
    password = str(payload.get("password") or "")

    if len(username) < settings.username_min_len or len(username) > settings.username_max_len:
        return JSONResponse({"ok": False, "error": "invalid_username"}, status_code=400)
    if len(password) < settings.password_min_len:
        return JSONResponse({"ok": False, "error": "password_too_short"}, status_code=400)

    async with AsyncSessionLocal() as db:
        make_admin = False
        if settings.bootstrap_first_user_admin:
            count_res = await db.execute(select(func.count(User.id)))
            if int(count_res.scalar() or 0) == 0:
                make_admin = True

        exists = await db.execute(select(User).where(User.username == username))
        if exists.scalar_one_or_none():
            return JSONResponse({"ok": False, "error": "username_taken"}, status_code=409)

        u = User(
            username=username,
            password_hash=hash_password(password),
            is_admin=make_admin,
            is_active=True,
            token_version=0,
        )
        db.add(u)
        await db.commit()
        await db.refresh(u)

        token = create_access_token(user=u)
        # Award daily login OP
        try:
            async with AsyncSessionLocal() as prestige_db:
                await prestige_login(prestige_db, int(u.id), "oracle")
                await prestige_db.commit()
        except Exception:
            pass
        return {"ok": True, "token": token, "is_admin": u.is_admin, "username": u.username}


@app.post("/auth/login")
async def auth_login(request: Request):
    payload = await _read_json_or_form(request)
    username = _norm_username(str(payload.get("username") or ""))
    password = str(payload.get("password") or "")

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(User).where(User.username == username))
        u = res.scalar_one_or_none()
        if not u:
            return JSONResponse({"ok": False, "error": "invalid_login"}, status_code=401)
        if not u.is_active:
            return JSONResponse({"ok": False, "error": "user_disabled"}, status_code=403)
        if not verify_password(password, u.password_hash):
            return JSONResponse({"ok": False, "error": "invalid_login"}, status_code=401)

        u.last_login_at = _utcnow_naive()
        await db.commit()

        token = create_access_token(user=u)
        return {"ok": True, "token": token, "is_admin": u.is_admin, "username": u.username}


@app.get("/auth/me")
async def auth_me(request: Request):
    async with AsyncSessionLocal() as db:
        u, err = await require_jwt_user(request, db)
        if err:
            return err
        assert u is not None
        return {"ok": True, "username": u.username, "is_admin": u.is_admin, "is_active": u.is_active}


# ---------------------------------------------------------------------------
# Admin endpoints (moderation)
# ---------------------------------------------------------------------------
@app.post("/admin/player/{player_id}/delete")
async def admin_delete_player(request: Request, player_id: int):
    async with AsyncSessionLocal() as db:
        _u, err = await require_jwt_user(request, db, require_admin=True)
        if err:
            return err

        await db.execute(delete(Player).where(Player.id == player_id))
        await db.commit()
        return {"ok": True}


@app.post("/admin/colony/{colony_id}/delete")
async def admin_delete_colony(request: Request, colony_id: int):
    async with AsyncSessionLocal() as db:
        _u, err = await require_jwt_user(request, db, require_admin=True)
        if err:
            return err

        await db.execute(delete(Colony).where(Colony.id == colony_id))
        await db.commit()
        return {"ok": True}


# ---------------------------------------------------------------------------
# Pages (READ for all)
# ---------------------------------------------------------------------------

@app.get("/prestige", response_class=HTMLResponse)
async def prestige_page(request: Request):
    """Oracle Prestige profile page — client-side auth via /api/prestige."""
    return _template(request, "prestige.html", {"active_nav": "prestige"})


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return _template(request, "login.html", {})

def _consteq(a: str, b: str) -> bool:
    """Constant-time string comparison to prevent timing attacks."""
    return hmac.compare_digest(a.encode(), b.encode())


@app.get("/", response_class=HTMLResponse)
async def index(request: Request, q: str = "", ally: str = "", tab: str = ""):
    q = (q or "").strip()
    ally = (ally or "").strip()
    async with AsyncSessionLocal() as db:
        if ally:
            sub = select(Colony.player_id).where(Colony.ally.ilike(f"%{ally}%")).distinct()
            stmt = select(Player).where(Player.id.in_(sub)).order_by(Player.name).limit(200)
        elif q:
            stmt = select(Player).where(Player.name.ilike(f"%{q}%")).order_by(Player.name).limit(50)
        else:
            stmt = select(Player).order_by(Player.name).limit(50)

        res = await db.execute(stmt)
        players = res.scalars().all()

        ally_res = await db.execute(
            select(Colony.ally)
            .where(Colony.ally.isnot(None), Colony.ally != "")
            .distinct()
            .order_by(Colony.ally)
        )
        alliances = [row[0] for row in ally_res.all()]

    return _template(
        request,
        "index.html",
        {"q": q, "ally": ally, "tab": tab, "players": players, "alliances": alliances, "active_nav": "search"},
    )


@app.get("/player/{name}", response_class=HTMLResponse)
async def player_page(request: Request, name: str):
    p = await get_player_by_name(name)
    if not p:
        return RedirectResponse(url="/?q=" + (name or ""), status_code=303)

    colonies = _sort_colonies(list(p.colonies or []))
    last_update = max((c.last_seen_at for c in colonies), default=None)

    astro = p.astro_level
    max_colonies = max_planets_for_astro(astro)
    actual_colonies = len(colonies)
    missing = max_colonies - actual_colonies

    return _template(
        request,
        "player.html",
        {
            "player": p,
            "colonies": colonies,
            "last_update": last_update,
            "astro": astro,
            "max_colonies": max_colonies,
            "actual_colonies": actual_colonies,
            "missing": missing,
            "active_nav": "search",
        },
    )


@app.get("/import-ui", response_class=HTMLResponse)
async def import_ui(request: Request):
    qp = request.query_params
    summary = None

    # show summary if at least one value is present
    if any(k in qp for k in ("imported", "updated", "players", "skipped")):
        summary = {
            "imported": qp.get("imported", "0"),
            "updated": qp.get("updated", "0"),
            "players": qp.get("players", "0"),
            "skipped": qp.get("skipped", "0"),
        }

    return _template(request, "import.html", {"summary": summary, "active_nav": "import"})


@app.get("/galaxy", response_class=HTMLResponse)
async def galaxy_overview(request: Request, g: int = 0):
    async with AsyncSessionLocal() as db:
        gal_res = await db.execute(select(GalaxyScan.galaxy).distinct().order_by(GalaxyScan.galaxy))
        galaxies = [row[0] for row in gal_res.all()]

        if g > 0:
            stmt = select(GalaxyScan).where(GalaxyScan.galaxy == g).order_by(GalaxyScan.galaxy, GalaxyScan.system)
        else:
            stmt = select(GalaxyScan).order_by(GalaxyScan.galaxy, GalaxyScan.system)

        res = await db.execute(stmt)
        scans = res.scalars().all()

    return _template(
        request,
        "galaxy.html",
        {"scans": scans, "galaxies": galaxies, "g": g, "now": _utcnow_naive(), "active_nav": "galaxy"},
    )


@app.get("/galaxy/{galaxy}/{system}", response_class=HTMLResponse)
async def galaxy_system(request: Request, galaxy: int, system: int):
    async with AsyncSessionLocal() as db:
        scan_res = await db.execute(select(GalaxyScan).where(GalaxyScan.galaxy == galaxy, GalaxyScan.system == system))
        scan = scan_res.scalar_one_or_none()

        col_res = await db.execute(
            select(Colony)
            .where(Colony.galaxy == galaxy, Colony.system == system)
            .options(selectinload(Colony.player))
            .order_by(Colony.position)
        )
        colonies = col_res.scalars().all()

    return _template(
        request,
        "galaxy_system.html",
        {"galaxy": galaxy, "system": system, "scan": scan, "colonies": colonies, "active_nav": "galaxy"},
    )


# ---------------------------------------------------------------------------
# Actions (manual) — requires JWT (account)
# CSRF is validated by middleware, but not a replacement for auth.
# ---------------------------------------------------------------------------
async def _require_user_for_write(request: Request, require_admin: bool = False):
    async with AsyncSessionLocal() as db:
        u, err = await require_jwt_user(request, db, require_admin=require_admin)
        if err:
            return None, err
        return u, None


@app.post("/player/add")
async def add_player(request: Request, name: str = Form(...)):
    _u, err = await _require_user_for_write(request, require_admin=True)
    if err:
        return err

    name = _norm_name(name)
    if not name:
        return RedirectResponse(url="/", status_code=303)

    async with AsyncSessionLocal() as db:
        exists = await db.execute(select(Player).where(Player.name == name))
        if exists.scalar_one_or_none():
            return RedirectResponse(url=f"/player/{name}", status_code=303)

        db.add(Player(name=name))
        await db.commit()

    return RedirectResponse(url=f"/player/{name}", status_code=303)


@app.post("/player/{name}/astro")
async def set_astro(request: Request, name: str, astro_level: int = Form(...)):
    _u, err = await _require_user_for_write(request, require_admin=True)
    if err:
        return err

    name = _norm_name(name)
    astro_level = int(astro_level)
    if astro_level < 0 or astro_level > 200:
        return RedirectResponse(url=f"/player/{name}", status_code=303)

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Player).where(Player.name == name))
        p = res.scalar_one_or_none()
        if not p:
            return RedirectResponse(url="/?q=" + name, status_code=303)

        p.astro_level = astro_level
        await db.commit()

    return RedirectResponse(url=f"/player/{name}", status_code=303)


@app.post("/colony/add")
async def add_colony(
    request: Request,
    player_name: str = Form(...),
    galaxy: int = Form(...),
    system: int = Form(...),
    position: int = Form(...),
    planet_name: str = Form(DEFAULT_PLANET_NAME),  # FIX: was "Colonie"
    is_main: bool = Form(False),
    has_moon: bool = Form(False),
    moon_name: Optional[str] = Form(None),
    travel_hint_minutes: Optional[int] = Form(None),
    note: Optional[str] = Form(None),
):
    _u, err = await _require_user_for_write(request, require_admin=True)
    if err:
        return err

    player_name = _norm_name(player_name)
    planet_name = (planet_name or DEFAULT_PLANET_NAME).strip() or DEFAULT_PLANET_NAME  # FIX: was "Colonie"
    note = (note or "").strip() or None
    moon_name = (moon_name or "").strip() or None

    async with AsyncSessionLocal() as db:
        p, _created = await get_or_create_player(db, player_name)

        stmt = select(Colony).where(
            Colony.player_id == p.id,
            Colony.galaxy == galaxy,
            Colony.system == system,
            Colony.position == position,
        )
        existing = (await db.execute(stmt)).scalar_one_or_none()

        now = _utcnow_naive()

        if existing:
            existing.planet_name = planet_name
            existing.is_main = bool(is_main)
            existing.has_moon = bool(has_moon)
            existing.moon_name = moon_name if has_moon else None
            existing.travel_hint_minutes = travel_hint_minutes
            existing.note = note
            existing.last_seen_at = now
            existing.source = SRC_MANUAL_EDIT
            if existing.is_main:
                await _ensure_single_main(db, p.id, existing.id)
        else:
            c = Colony(
                player_id=p.id,
                galaxy=galaxy,
                system=system,
                position=position,
                planet_name=planet_name,
                is_main=bool(is_main),
                has_moon=bool(has_moon),
                moon_name=moon_name if has_moon else None,
                travel_hint_minutes=travel_hint_minutes,
                note=note,
                last_seen_at=now,
                source=SRC_MANUAL_ADD,
            )
            db.add(c)
            await db.flush()
            if c.is_main:
                await _ensure_single_main(db, p.id, c.id)

        await db.commit()

    return RedirectResponse(url=f"/player/{player_name}", status_code=303)


@app.post("/colony/{colony_id}/update")
async def update_colony(
    request: Request,
    colony_id: int,
    player_name: str = Form(...),
    planet_name: str = Form(DEFAULT_PLANET_NAME),  # FIX: was "Colonie"
    is_main: bool = Form(False),
    has_moon: bool = Form(False),
    moon_name: Optional[str] = Form(None),
    travel_hint_minutes: Optional[int] = Form(None),
    note: Optional[str] = Form(None),
):
    _u, err = await _require_user_for_write(request, require_admin=True)
    if err:
        return err

    player_name = _norm_name(player_name)
    planet_name = (planet_name or DEFAULT_PLANET_NAME).strip() or DEFAULT_PLANET_NAME  # FIX: was "Colonie"
    note = (note or "").strip() or None
    moon_name = (moon_name or "").strip() or None

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Colony).where(Colony.id == colony_id).options(selectinload(Colony.player)))
        c = res.scalar_one_or_none()
        if not c:
            return RedirectResponse(url=f"/player/{player_name}", status_code=303)

        c.planet_name = planet_name
        c.is_main = bool(is_main)
        c.has_moon = bool(has_moon)
        c.moon_name = moon_name if has_moon else None
        c.travel_hint_minutes = travel_hint_minutes
        c.note = note
        c.last_seen_at = _utcnow_naive()
        c.source = SRC_MANUAL_EDIT

        if c.is_main:
            await _ensure_single_main(db, c.player_id, c.id)

        await db.commit()

    return RedirectResponse(url=f"/player/{player_name}", status_code=303)


@app.post("/colony/{colony_id}/delete")
async def delete_colony(request: Request, colony_id: int, player_name: str = Form(...)):
    _u, err = await _require_user_for_write(request, require_admin=True)
    if err:
        return err

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Colony).where(Colony.id == colony_id))
        c = res.scalar_one_or_none()
        if not c:
            return RedirectResponse(url=f"/player/{player_name}", status_code=303)

        pid = c.player_id
        await db.delete(c)
        await db.flush()
        deleted = await _delete_player_if_no_colonies(db, pid)
        await db.commit()

        if deleted:
            return RedirectResponse(url="/?q=" + player_name, status_code=303)
        return RedirectResponse(url=f"/player/{player_name}", status_code=303)


# ---------------------------------------------------------------------------
# CSV Import / Export — hardened
# Import requires JWT.
# ---------------------------------------------------------------------------
async def _read_upload_limited(file: UploadFile, limit: int) -> bytes:
    data = bytearray()
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        data.extend(chunk)
        if len(data) > limit:
            raise ValueError("upload_too_large")
    return bytes(data)


@app.post("/import")
async def import_csv(request: Request, file: UploadFile = File(...)):
    _u, err = await _require_user_for_write(request, require_admin=True)
    if err:
        return err

    try:
        raw = await _read_upload_limited(file, settings.max_upload_bytes)
    except ValueError:
        return PlainTextResponse("upload too large", status_code=413)

    # FIX: renamed from `text` to `csv_text` to avoid shadowing SQLAlchemy's `text()` import
    csv_text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(csv_text))

    imported = 0
    updated = 0
    created_players = 0
    rows_seen = 0
    rows_skipped = 0

    # (g,s) -> set(positions)
    gs_planets = defaultdict(set)
    # (g,s) -> newest naive UTC timestamp
    gs_last_seen: dict[tuple[int, int], datetime] = {}

    def _parse_dt(v: Any) -> Optional[datetime]:
        """
        Accept ISO timestamps like:
        - 2026-02-23T02:26:57.524665
        - 2026-02-23T02:26:57.524665Z
        - 2026-02-23T02:26:57+00:00
        Returns naive UTC datetime (tz stripped), matching app storage.
        """
        try:
            s = (str(v or "")).strip()
            if not s:
                return None
            if s.endswith("Z"):
                s = s[:-1] + "+00:00"
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is not None:
                dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
            return dt
        except Exception:
            return None

    async with AsyncSessionLocal() as db:
        for row in reader:
            rows_seen += 1
            if rows_seen > settings.max_csv_rows:
                return PlainTextResponse("too many rows", status_code=413)

            # Normalize player like ingest
            player_name = _norm_player_name(row.get("player") or row.get("name") or "")[:64]
            if not player_name:
                rows_skipped += 1
                continue

            # coords
            try:
                galaxy = int(str(row.get("galaxy") or row.get("g") or "0").strip() or 0)
                system = int(str(row.get("system") or row.get("s") or "0").strip() or 0)
                position = int(str(row.get("position") or row.get("pos") or "0").strip() or 0)
            except Exception:
                rows_skipped += 1
                continue

            # strict validation
            if galaxy <= 0 or system <= 0 or position < 1 or position > 30:
                rows_skipped += 1
                continue

            # Track GalaxyScan from CSV
            gs_key = (galaxy, system)
            gs_planets[gs_key].add(position)

            seen_from_csv = _parse_dt(row.get("last_seen_at"))
            if seen_from_csv is not None:
                prev = gs_last_seen.get(gs_key)
                if prev is None or seen_from_csv > prev:
                    gs_last_seen[gs_key] = seen_from_csv

            # fields
            # FIX: default fallback changed from "Colonie" to DEFAULT_PLANET_NAME ("Colony")
            planet_name = (row.get("planet_name") or row.get("planet") or DEFAULT_PLANET_NAME).strip()
            planet_name = (planet_name[: settings.max_field_len] or DEFAULT_PLANET_NAME)

            is_main = _to_bool(row.get("is_main"))
            hint = _to_int_or_none(row.get("travel_hint_minutes"))

            note = (row.get("note") or "").strip()
            note = (note[: settings.max_field_len] or None)

            has_moon = _to_bool(row.get("has_moon"))
            moon_name = (row.get("moon_name") or "").strip()
            moon_name = (moon_name[: settings.max_field_len] or None)

            ally = (row.get("ally") or "").strip()
            ally = (ally[:32] or None)

            # Keep timestamp if present, else now
            seen = seen_from_csv or _utcnow_naive()

            p, created = await get_or_create_player(db, player_name)
            if created:
                created_players += 1

            stmt = select(Colony).where(
                Colony.player_id == p.id,
                Colony.galaxy == galaxy,
                Colony.system == system,
                Colony.position == position,
            )
            existing = (await db.execute(stmt)).scalar_one_or_none()

            if existing:
                existing.planet_name = planet_name
                existing.is_main = bool(is_main)
                existing.ally = ally
                existing.travel_hint_minutes = hint
                existing.note = note
                existing.has_moon = bool(has_moon)
                existing.moon_name = moon_name if has_moon else None
                existing.last_seen_at = seen
                existing.source = SRC_IMPORT

                if existing.is_main:
                    await _ensure_single_main(db, p.id, existing.id)
                updated += 1
            else:
                c = Colony(
                    player_id=p.id,
                    galaxy=galaxy,
                    system=system,
                    position=position,
                    planet_name=planet_name,
                    is_main=bool(is_main),
                    ally=ally,
                    has_moon=bool(has_moon),
                    moon_name=moon_name if has_moon else None,
                    travel_hint_minutes=hint,
                    note=note,
                    last_seen_at=seen,
                    source=SRC_IMPORT,
                )
                db.add(c)
                await db.flush()
                if c.is_main:
                    await _ensure_single_main(db, p.id, c.id)
                imported += 1

        # Build GalaxyScan entries from CSV (so /galaxy works immediately)
        fallback_now = _utcnow_naive()
        for (g, s), pos_set in gs_planets.items():
            scanned_at = gs_last_seen.get((g, s)) or fallback_now
            await _upsert_galaxy_scan(
                db,
                galaxy=g,
                system=s,
                scanned_at=scanned_at,
                planets_found=len(pos_set),
            )

        await db.commit()

    return RedirectResponse(
        url=f"/import-ui?imported={imported}&updated={updated}&players={created_players}&skipped={rows_skipped}",
        status_code=303,
    )


@app.get("/export.csv")
async def export_csv():
    async with AsyncSessionLocal() as db:
        stmt = (
            select(Colony, Player)
            .join(Player, Player.id == Colony.player_id)
            .order_by(Player.name, Colony.galaxy, Colony.system, Colony.position)
        )
        res = await db.execute(stmt)
        rows = res.all()

    def gen():
        out = io.StringIO()
        w = csv.writer(out)
        w.writerow(
            [
                "player",
                "galaxy",
                "system",
                "position",
                "planet_name",
                "is_main",
                "has_moon",
                "moon_name",
                "travel_hint_minutes",
                "note",
                "last_seen_at",
                "source",
                "ally",
            ]
        )
        yield out.getvalue()
        out.seek(0)
        out.truncate(0)

        for c, p in rows:
            w.writerow(
                [
                    p.name,
                    c.galaxy,
                    c.system,
                    c.position,
                    c.planet_name,
                    "true" if c.is_main else "false",
                    "true" if c.has_moon else "false",
                    c.moon_name or "",
                    c.travel_hint_minutes if c.travel_hint_minutes is not None else "",
                    c.note or "",
                    c.last_seen_at.isoformat() if c.last_seen_at else "",
                    c.source,
                    c.ally or "",
                ]
            )
            yield out.getvalue()
            out.seek(0)
            out.truncate(0)

    return StreamingResponse(
        gen(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=ogx-export.csv"},
    )


# ---------------------------------------------------------------------------
# Ingest (Helper Sync -> Local Tracker)
# JWT Bearer preferred, API key fallback (transition).
# ---------------------------------------------------------------------------
@app.post("/ingest/galaxy")
async def ingest_galaxy(request: Request, payload: dict = Body(...)):
    galaxy = int(payload.get("galaxy", 0) or 0)
    system = int(payload.get("system", 0) or 0)
    rows = payload.get("rows") or []

    if galaxy <= 0 or system <= 0:
        return {"ok": False, "error": "invalid galaxy/system"}
    if not isinstance(rows, list):
        return {"ok": False, "error": "rows must be list"}
    if len(rows) > 50:
        return {"ok": False, "error": "too many rows"}

    imported = 0
    updated = 0
    created_players = 0
    now = _utcnow_naive()

    async with AsyncSessionLocal() as db:
        auth_err = await require_ingest_auth(request, db)
        if auth_err:
            return auth_err

        for r in rows:
            try:
                position = int(r.get("position", 0) or 0)
            except Exception:
                continue
            if position <= 0 or position > 30:
                continue

            player_name = _norm_player_name(r.get("player") or "")[:64]
            if not player_name:
                continue

            # FIX: default fallback changed from "Colonie" to DEFAULT_PLANET_NAME ("Colony")
            planet_name = (r.get("planet_name") or DEFAULT_PLANET_NAME).strip()[:128] or DEFAULT_PLANET_NAME
            ally = (r.get("ally") or "").strip()[:32] or None
            has_moon = bool(r.get("has_moon", False))
            moon_name = (r.get("moon_name") or "").strip()[:128] or None
            debris_metal = int(r.get("debris_metal") or 0)
            debris_crystal = int(r.get("debris_crystal") or 0)

            note_raw = (r.get("note") or "").strip()
            note = _re.sub(r"ALLY:\S+\s*", "", note_raw).strip()[:255] or None

            p, created = await get_or_create_player(db, player_name)
            if created:
                created_players += 1

            stmt = select(Colony).where(
                Colony.player_id == p.id,
                Colony.galaxy == galaxy,
                Colony.system == system,
                Colony.position == position,
            )
            existing = (await db.execute(stmt)).scalar_one_or_none()

            if existing:
                existing.planet_name = planet_name
                existing.ally = ally
                existing.note = note
                existing.has_moon = has_moon
                existing.moon_name = moon_name if has_moon else None
                existing.last_seen_at = now
                existing.source = SRC_HELPER
                if debris_metal:   existing.debris_metal = debris_metal
                if debris_crystal: existing.debris_crystal = debris_crystal
                updated += 1
            else:
                db.add(
                    Colony(
                        player_id=p.id,
                        galaxy=galaxy,
                        system=system,
                        position=position,
                        planet_name=planet_name,
                        is_main=False,
                        ally=ally,
                        has_moon=has_moon,
                        moon_name=moon_name if has_moon else None,
                        travel_hint_minutes=None,
                        note=note,
                        last_seen_at=now,
                        source=SRC_HELPER,
                    )
                )
                # Update debris via raw SQL (Colony model may lack these columns)
                if debris_metal or debris_crystal:
                    await db.flush()
                    await db.execute(text(
                        "UPDATE colonies SET debris_metal=:dm, debris_crystal=:dc "
                        "WHERE player_id=:pid AND galaxy=:g AND system=:s AND position=:pos"
                    ), {"dm": debris_metal or 0, "dc": debris_crystal or 0,
                        "pid": p.id, "g": galaxy, "s": system, "pos": position})
                imported += 1

        await _upsert_galaxy_scan(db, galaxy=galaxy, system=system, scanned_at=now, planets_found=len(rows))

        # Award OP for new unique system scanned
        new_systems = 1 if (imported > 0 or updated > 0) else 0
        if new_systems > 0:
            try:
                u, _err = await require_jwt_user(request, db, require_admin=False)
                if u:
                    await prestige_scan(db, int(u.id), new_systems)
            except Exception:
                pass  # never block ingest on prestige errors

        await db.commit()

    return {"ok": True, "imported": imported, "updated": updated, "players_created": created_players}


# ---------------------------------------------------------------------------
# Smuggler Codes — found via Bridge expo sync
# ---------------------------------------------------------------------------

@app.get("/api/smuggler/codes")
async def smuggler_codes(request: Request):
    """Returns all smuggler codes the current user has found via expeditions."""
    async with AsyncSessionLocal() as db:
        user = await require_jwt_user(request, db)
        if isinstance(user, JSONResponse):
            return user

        rows = (await db.execute(
            text("""SELECT code, level, found_at, expo_date, prestige_xp_awarded
                    FROM smuggler_found_codes
                    WHERE user_id = :uid
                    ORDER BY found_at DESC"""),
            {"uid": user.id}
        )).fetchall()

        return {
            "ok": True,
            "total": len(rows),
            "codes": [
                {
                    "code": r.code,
                    "level": r.level,
                    "found_at": r.found_at.isoformat() if r.found_at else None,
                    "expo_date": r.expo_date.isoformat() if r.expo_date else None,
                    "prestige_xp": r.prestige_xp_awarded,
                }
                for r in rows
            ]
        }

# ---------------------------------------------------------------------------
# Language — persistent cookie
# ---------------------------------------------------------------------------

@app.post("/api/set-lang")
async def set_lang(request: Request):
    """Set language preference cookie. Body: {lang: "de"|"en"|"fr"}"""
    body = await _read_json_or_form(request)
    lang = (body.get("lang") or "").strip().lower()[:2]
    if lang not in SUPPORTED:
        return JSONResponse({"ok": False, "error": "unsupported language"}, status_code=400)
    response = JSONResponse({"ok": True, "lang": lang})
    response.set_cookie(
        key=LANG_COOKIE,
        value=lang,
        max_age=60 * 60 * 24 * 365,  # 1 year
        httponly=False,               # JS readable for display
        samesite="lax",
        secure=False,                 # Railway handles HTTPS at proxy level
    )
    return response


# ── Language ─────────────────────────────────────────────────────────────────

@app.post("/api/set-lang")
async def api_set_lang(request: Request):
    """Sprache als Cookie setzen. Body JSON: {lang: "de"|"en"|...}"""
    try:
        body = await request.json()
    except Exception:
        body = {}
    lang = (body.get("lang") or "").strip().lower()[:2]
    if lang not in SUPPORTED:
        return JSONResponse({"ok": False, "error": "unsupported language"}, status_code=400)
    resp = JSONResponse({"ok": True, "lang": lang})
    resp.set_cookie(
        key=LANG_COOKIE,
        value=lang,
        max_age=365 * 24 * 3600,
        httponly=False,
        samesite="lax",
        secure=False,
    )
    return resp


# ---------------------------------------------------------------------------
# Glad Bridge — Account Linking & Galaxy Sync
# ---------------------------------------------------------------------------

def _bridge_url(action: str, params: dict = {}, server_id: str = "uni1") -> str:
    base = getattr(settings, "glad_bridge_url", "") or ""
    secret = getattr(settings, "glad_bridge_secret", "") or ""
    p = f"action={action}&secret={secret}&server_id={server_id}"
    for k, v in params.items():
        if k != "server_id":  # avoid duplicate
            p += f"&{k}={v}"
    return f"{base}?{p}"

async def _call_bridge(action: str, params: dict = {}, server_id: str = "uni1") -> dict:
    try:
        import httpx
        url = _bridge_url(action, params, server_id=server_id)
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(url)
            r.raise_for_status()
            return r.json()
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/link", response_class=HTMLResponse)
async def link_page(request: Request):
    lang = get_lang(request)
    t = make_translator(lang)
    return _template(request, "link.html", {
        "title": t("link.title"),
        "active_nav": "link",
    })


@app.post("/api/link/start")
async def link_start(request: Request):
    async with AsyncSessionLocal() as db:
        user = await require_jwt_user(request, db)
        if isinstance(user, JSONResponse):
            return user
        code = "OGX-" + secrets.token_hex(3).upper()
        now = _utcnow_naive()
        if IS_POSTGRES:
            await db.execute(text("""
                INSERT INTO link_codes (user_id, code, created_at, used)
                VALUES (:uid, :code, :now, false)
                ON CONFLICT (user_id) DO UPDATE SET code = :code, created_at = :now, used = false
            """), {"uid": user.id, "code": code, "now": now})
        else:
            await db.execute(text("""
                INSERT OR REPLACE INTO link_codes (user_id, code, created_at, used)
                VALUES (:uid, :code, :now, 0)
            """), {"uid": user.id, "code": code, "now": now})
        await db.commit()
        return {"ok": True, "code": code}


@app.post("/api/link/poll")
async def link_poll(request: Request):
    """
    Client polls this after showing the code to the user.
    Oracle calls Glad's verify endpoint; if the player has saved the code in OGX
    Preferences, Glad returns player_id + username and we finalise the link.

    Body JSON: { "server_id": "uni1" }   (optional, defaults to "uni1")
    """
    async with AsyncSessionLocal() as db:
        user = await require_jwt_user(request, db)
        if isinstance(user, JSONResponse):
            return user

        # Get user's pending link code
        row = (await db.execute(
            text("SELECT code, used FROM link_codes WHERE user_id = :uid"),
            {"uid": user.id}
        )).fetchone()

        if not row:
            return JSONResponse({"ok": False, "error": "no_code"}, status_code=404)
        if row.used:
            # Already linked — return existing account
            linked = (await db.execute(
                text("SELECT game_player_id, game_username, server_id FROM linked_accounts WHERE user_id = :uid LIMIT 1"),
                {"uid": user.id}
            )).fetchone()
            return {"ok": True, "linked": True,
                    "game_username": linked.game_username if linked else "",
                    "game_player_id": linked.game_player_id if linked else None}

        try:
            body = await request.json()
        except Exception:
            body = {}
        # Try all known servers until one confirms the code
        # Glad's verify returns server_id in the response so we know which server matched
        known_servers = ["uni1", "beta"]
        bridge_result = None
        for srv in known_servers:
            result = await _call_bridge("verify", {"code": row.code}, server_id=srv)
            if result.get("ok"):
                bridge_result = result
                break
            if result.get("error") not in ("code_pending", "code_not_found", "unauthorized"):
                # Unexpected error — still keep trying other servers
                pass

        if bridge_result is None:
            # All servers returned code_pending / not found
            return {"ok": True, "linked": False, "pending": True}

        if not bridge_result.get("ok"):
            err = bridge_result.get("error", "")
            return {"ok": False, "error": err or "bridge_error"}

        player_id = bridge_result.get("player_id")
        username  = (bridge_result.get("username") or "").strip()
        returned_server = (bridge_result.get("server_id") or "uni1").strip()

        if not player_id or not username:
            return {"ok": False, "error": "bridge_missing_fields"}

        now = _utcnow_naive()

        # Mark code as used
        await db.execute(text("""
            UPDATE link_codes
            SET used = true, game_player_id = :gid, game_username = :gun, verified_at = :now
            WHERE user_id = :uid
        """), {"gid": player_id, "gun": username, "now": now, "uid": user.id})

        # Upsert linked_accounts
        if IS_POSTGRES:
            await db.execute(text("""
                INSERT INTO linked_accounts (user_id, server_id, game_player_id, game_username, linked_at)
                VALUES (:uid, :sid, :gid, :gun, :now)
                ON CONFLICT (user_id, server_id) DO UPDATE
                    SET game_player_id = :gid, game_username = :gun, linked_at = :now
            """), {"uid": user.id, "sid": returned_server, "gid": player_id, "gun": username, "now": now})
        else:
            await db.execute(text("""
                INSERT OR REPLACE INTO linked_accounts (user_id, server_id, game_player_id, game_username, linked_at)
                VALUES (:uid, :sid, :gid, :gun, :now)
            """), {"uid": user.id, "sid": returned_server, "gid": player_id, "gun": username, "now": now})

        await db.commit()

        return {"ok": True, "linked": True, "game_username": username, "game_player_id": player_id, "server_id": returned_server}


@app.post("/api/link/unlink")
async def link_unlink(request: Request):
    async with AsyncSessionLocal() as db:
        user = await require_jwt_user(request, db)
        if isinstance(user, JSONResponse):
            return user
        await db.execute(text("DELETE FROM link_codes WHERE user_id = :uid"), {"uid": user.id})
        await db.execute(text("DELETE FROM linked_accounts WHERE user_id = :uid"), {"uid": user.id})
        await db.commit()
        return {"ok": True}


@app.get("/api/bridge/status")
async def bridge_status(request: Request):
    """Check if current user has a linked game account"""
    async with AsyncSessionLocal() as db:
        user = await require_jwt_user(request, db)
        if isinstance(user, JSONResponse):
            return user
        row = (await db.execute(
            text("SELECT game_player_id, game_username, server_id FROM linked_accounts WHERE user_id = :uid LIMIT 1"),
            {"uid": user.id}
        )).fetchone()
        if row:
            return {"ok": True, "linked": True,
                    "game_username": row.game_username,
                    "game_player_id": row.game_player_id,
                    "server_id": row.server_id or "uni1"}
        return {"ok": True, "linked": False}


@app.get("/api/bridge/expo")
async def bridge_expo(request: Request):
    async with AsyncSessionLocal() as db:
        user = await require_jwt_user(request, db)
        if isinstance(user, JSONResponse):
            return user

        # Get user's linked code + server
        link_row = (await db.execute(
            text("SELECT l.code, l.used, la.server_id FROM link_codes l "
                 "LEFT JOIN linked_accounts la ON la.user_id = l.user_id "
                 "WHERE l.user_id = :uid AND l.used = true LIMIT 1"),
            {"uid": user.id}
        )).fetchone()
        if not link_row:
            return {"ok": False, "error": "not_linked"}

        server_id = (link_row.server_id or "uni1").strip()
        since = request.query_params.get("since", "0")
        limit = request.query_params.get("limit", "500")

        # Fetch from Glad's bridge
        result = await _call_bridge("expo", {"code": link_row.code, "since": since, "limit": limit}, server_id=server_id)
        if not result.get("ok"):
            return result

        # Process expedition list — extract smuggler codes
        expeditions = result.get("expeditions", [])
        now = _utcnow_naive()
        smuggler_found = 0
        xp_earned = 0

        for expo in expeditions:
            smuggler_code = (expo.get("smuggler_code") or "").strip()
            if not smuggler_code:
                continue

            smuggler_level = int(expo.get("smuggler_level") or 1)
            xp_per_level = {1: 100, 2: 250, 3: 500}
            xp = xp_per_level.get(smuggler_level, 100)

            expo_date_str = expo.get("date") or ""
            expo_date = None
            try:
                from datetime import datetime as _dt
                expo_date = _dt.fromisoformat(expo_date_str.replace("Z", "+00:00")).replace(tzinfo=None)
            except Exception:
                pass

            # Upsert into smuggler_found_codes (UNIQUE user_id + code)
            try:
                if IS_POSTGRES:
                    await db.execute(text("""
                        INSERT INTO smuggler_found_codes
                            (user_id, server_id, code, level, found_at, expo_date, prestige_xp_awarded)
                        VALUES (:uid, :sid, :code, :lvl, :now, :ed, :xp)
                        ON CONFLICT (user_id, code) DO NOTHING
                    """), {"uid": user.id, "sid": server_id, "code": smuggler_code,
                           "lvl": smuggler_level, "now": now, "ed": expo_date, "xp": xp})
                else:
                    await db.execute(text("""
                        INSERT OR IGNORE INTO smuggler_found_codes
                            (user_id, server_id, code, level, found_at, expo_date, prestige_xp_awarded)
                        VALUES (:uid, :sid, :code, :lvl, :now, :ed, :xp)
                    """), {"uid": user.id, "sid": server_id, "code": smuggler_code,
                           "lvl": smuggler_level, "now": now, "ed": expo_date, "xp": xp})

                # Check if this was a new insert (rows_affected > 0 means new)
                inserted = (await db.execute(
                    text("SELECT id FROM smuggler_found_codes WHERE user_id = :uid AND code = :code AND found_at = :now"),
                    {"uid": user.id, "code": smuggler_code, "now": now}
                )).fetchone()

                if inserted:
                    smuggler_found += 1
                    xp_earned += xp
            except Exception:
                pass  # never block expo sync on smuggler errors

        # Award Prestige XP for newly found codes
        if xp_earned > 0:
            try:
                from .prestige import award_op
                await award_op(db, int(user.id), xp_earned, reason="smuggler_found")
            except Exception:
                pass

        await db.commit()

        return {
            **result,
            "smuggler_found_this_sync": smuggler_found,
            "smuggler_xp_earned": xp_earned,
        }


@app.post("/api/bridge/galaxy")
async def bridge_galaxy(request: Request, payload: dict = Body(...)):
    async with AsyncSessionLocal() as db:
        user = await require_jwt_user(request, db)
        if isinstance(user, JSONResponse):
            return user
        galaxy = int(payload.get("galaxy", 0) or 0)
        system = int(payload.get("system", 0) or 0)
        if galaxy <= 0 or system <= 0:
            return {"ok": False, "error": "invalid coordinates"}
        result = await _call_bridge("galaxy", {"galaxy": galaxy, "system": system})
        if not result.get("ok"):
            return result
        rows = result.get("planets", [])
        now = _utcnow_naive()
        imported = 0
        for r in rows:
            try:
                position = int(r.get("position", 0) or 0)
            except Exception:
                continue
            if position <= 0:
                continue
            player_name = (r.get("player") or "").strip()[:64]
            if not player_name:
                continue
            planet_name = (r.get("planet_name") or "Colony").strip()[:128]
            ally = (r.get("ally") or "").strip()[:32] or None
            has_moon = bool(r.get("has_moon", False))
            player, _ = await get_or_create_player(db, player_name)
            if ally and not player.ally:
                player.ally = ally
                db.add(player)
            from sqlalchemy import and_
            existing = (await db.execute(
                select(Colony).where(and_(
                    Colony.player_id == player.id,
                    Colony.galaxy == galaxy,
                    Colony.system == system,
                    Colony.position == position
                ))
            )).scalar_one_or_none()
            if existing:
                existing.planet_name = planet_name
                existing.has_moon = has_moon
                existing.ally = ally
                existing.last_seen_at = now
                existing.source = "bridge"
            else:
                db.add(Colony(
                    player_id=player.id, galaxy=galaxy, system=system,
                    position=position, planet_name=planet_name,
                    has_moon=has_moon, ally=ally, last_seen_at=now, source="bridge"
                ))
            imported += 1
        await _upsert_galaxy_scan(db, galaxy=galaxy, system=system,
                                  scanned_at=now, planets_found=imported)
        await db.commit()
        return {"ok": True, "imported": imported}
