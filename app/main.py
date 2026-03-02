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

from fastapi import FastAPI, Request, Form, UploadFile, File, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse, PlainTextResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from sqlalchemy import select, func, delete, text, update
from sqlalchemy.orm import selectinload

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
from .i18n import get_lang, make_translator, get_translations_js, SUPPORTED, FLAG, LABEL
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
        async with AsyncSessionLocal() as db:
            await seed_achievements(db)
    else:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
            await conn.run_sync(Base.metadata.create_all)
        async with AsyncSessionLocal() as db:
            await seed_achievements(db)

    yield


app = FastAPI(title="OGX Oracle", lifespan=lifespan)

# Static
app.mount("/static", StaticFiles(directory=str(APP_DIR / "static")), name="static")

# CORS:
# NOTE: GM_xmlhttpRequest does not require CORS.
# But browser fetch from uni tab DOES.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://uni1.playogx.com", "http://uni1.playogx.com"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],  # FIX: include GET for /api/prestige & /api/leaderboard
    allow_headers=["content-type", "x-ogx-api-key", "authorization", "x-csrf-token"],
)

# Security middlewares (order matters!)
app.add_middleware(MaxSizeMiddleware)
app.add_middleware(SimpleRateLimitMiddleware)
app.add_middleware(CsrfMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestIdLoggingMiddleware)


# ---------------------------------------------------------------------------
# Source constants
# ---------------------------------------------------------------------------
SRC_MANUAL_ADD = "manual_add"
SRC_MANUAL_EDIT = "manual_edit"
SRC_IMPORT = "import"
SRC_HELPER = "helper"

DEFAULT_PLANET_NAME = "Colony"


def _template(request: Request, name: str, ctx: dict) -> HTMLResponse:
    """
    Always provide csrf_token and i18n to templates.
    """
    csrf_token = getattr(request.state, "csrf_token", None) or request.cookies.get(CSRF_COOKIE) or ""
    lang = get_lang(request)
    base = {
        "request": request,
        "csrf_token": csrf_token,
        "t": make_translator(lang),
        "lang": lang,
        "i18n_js": get_translations_js(lang),
        "settings": settings,
    }
    base.update(ctx)
    return templates.TemplateResponse(request, name, base)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
@app.get("/i18n.js")
async def i18n_js(request: Request):
    """
    Serve translations as external JS (CSP-safe).
    This replaces any inline <script>{{ i18n_js }}</script> usage in templates.
    """
    lang = get_lang(request)
    js = get_translations_js(lang)
    return PlainTextResponse(js, media_type="application/javascript; charset=utf-8")

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
    """Normalize username consistently (DB expects this form)."""
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
    await db.execute(
        update(Colony)
        .where(Colony.player_id == player_id, Colony.id != main_colony_id)
        .values(is_main=False)
    )
    await db.execute(
        update(Colony)
        .where(Colony.id == main_colony_id)
        .values(is_main=True)
    )


async def _upsert_galaxy_scan(db, *, galaxy: int, system: int, scanned_at: datetime, planets_found: int) -> None:
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
    async with AsyncSessionLocal() as db:
        u, err = await require_jwt_user(request, db)
        if err:
            return JSONResponse({"ok": False, "error": "unauthorized"}, status_code=401)

        summary = await get_prestige_summary(db, int(u.id))
        board = await prestige_leaderboard(db, limit=20)

        for entry in board:
            res = await db.execute(select(User).where(User.id == entry["user_id"]))
            usr = res.scalar_one_or_none()
            entry["username"] = usr.username if usr else f"user_{entry['user_id']}"
            entry["is_current_user"] = (entry["user_id"] == int(u.id))

        return JSONResponse({"ok": True, **summary, "leaderboard": board})


@app.get("/api/leaderboard")
async def api_leaderboard(request: Request):
    """Top 20 leaderboard — public."""
    async with AsyncSessionLocal() as db:
        board = await prestige_leaderboard(db, limit=20)
        for entry in board:
            res = await db.execute(select(User).where(User.id == entry["user_id"]))
            usr = res.scalar_one_or_none()
            entry["username"] = usr.username if usr else f"user_{entry['user_id']}"
        return JSONResponse({"ok": True, "leaderboard": board})


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.get("/readyz")
async def readyz():
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"ok": False, "error": "db_unreachable", "detail": str(e)}, status_code=503)


# ---------------------------------------------------------------------------
# AUTH API (JWT)
# ---------------------------------------------------------------------------
@app.post("/auth/register")
async def auth_register(payload: dict = Body(...)):
    if not settings.allow_registration:
        return JSONResponse({"ok": False, "error": "registration_disabled"}, status_code=403)

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

        try:
            async with AsyncSessionLocal() as prestige_db:
                await prestige_login(prestige_db, int(u.id), "oracle")
                await prestige_db.commit()
        except Exception:
            pass

        return {"ok": True, "token": token, "is_admin": u.is_admin, "username": u.username}


@app.post("/auth/login")
async def auth_login(payload: dict = Body(...)):
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
    return _template(request, "prestige.html", {"active_nav": "prestige"})


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return _template(request, "login.html", {})


@app.get("/login/success", response_class=HTMLResponse)
async def login_success_page(request: Request):
    return _template(request, "login_success.html", {})


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
# ---------------------------------------------------------------------------
async def _require_user_for_write(request: Request, db=None):
    """
    Require a logged-in JWT user for write operations.

    - If `db` is provided (AsyncSession), reuse it.
    - Otherwise create a short-lived session.
    """
    if db is not None:
        u, err = await require_jwt_user(request, db, require_admin=False)
        if err:
            return None, err
        return u, None

    async with AsyncSessionLocal() as db2:
        u, err = await require_jwt_user(request, db2, require_admin=False)
        if err:
            return None, err
        return u, None


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


# ---------------------------------------------------------------------------
# Ingest user resolver (single source of truth)  ✅ FIX: only defined ONCE
# ---------------------------------------------------------------------------
async def _get_ingest_user(request: Request, db) -> Optional[User]:
    """
    Resolve the user behind an ingest request.

    Priority:
    1) JWT Bearer (preferred)
    2) API key fallback (optional) -> maps to a configured "system" user

    Returns:
        User | None
    Never raises.
    """
    # 1) Prefer JWT user
    try:
        u, err = await require_jwt_user(request, db, require_admin=False)
        if not err and u:
            return u
    except Exception:
        pass

    # 2) Optional API-key fallback
    api_key = request.headers.get("x-ogx-api-key") or ""
    cfg_key = getattr(settings, "ingest_api_key", None)
    if not cfg_key or api_key != cfg_key:
        return None

    cfg_uid = getattr(settings, "ingest_user_id", None)
    try:
        if cfg_uid is not None:
            res = await db.execute(select(User).where(User.id == int(cfg_uid), User.is_active == True))
            return res.scalar_one_or_none()

        res = await db.execute(
            select(User).where(User.is_active == True, User.is_admin == True).order_by(User.id.asc()).limit(1)
        )
        return res.scalar_one_or_none()
    except Exception:
        return None


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

    ingest_user_id: Optional[int] = None

    async with AsyncSessionLocal() as db:
        auth_err = await require_ingest_auth(request, db)
        if auth_err:
            return auth_err

        # Resolve ingest user once (store only the id so we don't keep ORM objects around)
        try:
            ingest_user = await _get_ingest_user(request, db)
            ingest_user_id = int(ingest_user.id) if ingest_user else None
        except Exception:
            ingest_user_id = None

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

            planet_name = (r.get("planet_name") or DEFAULT_PLANET_NAME).strip()[:128] or DEFAULT_PLANET_NAME
            ally = (r.get("ally") or "").strip()[:32] or None
            has_moon = bool(r.get("has_moon", False))
            moon_name = (r.get("moon_name") or "").strip()[:128] or None

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
                imported += 1

        await _upsert_galaxy_scan(db, galaxy=galaxy, system=system, scanned_at=now, planets_found=len(rows))
        await db.commit()

    # Award OP for new unique system scans (never block ingest)
    if imported > 0 and ingest_user_id is not None:
        try:
            async with AsyncSessionLocal() as prestige_db:
                await prestige_scan(prestige_db, ingest_user_id, 1)
                await prestige_db.commit()
        except Exception:
            pass

    return {"ok": True, "imported": imported, "updated": updated, "players_created": created_players}
