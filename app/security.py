# app/security.py
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
import os
from dataclasses import dataclass
from typing import Callable, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse, PlainTextResponse
from starlette.types import ASGIApp

from .models import User
from .settings import settings

CSRF_COOKIE = "ogx_csrf"
CSRF_HEADER = "x-csrf-token"
APIKEY_HEADER = "x-ogx-api-key"
AUTH_HEADER = "authorization"


# =============================================================================
# Small helpers
# =============================================================================
def _b64url_bytes(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")


def _b64url(nbytes: int = 32) -> str:
    return _b64url_bytes(secrets.token_bytes(nbytes))


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _consteq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def _is_https_request(request: Request) -> bool:
    """
    Determines whether the request should be treated as HTTPS.
    Important behind reverse proxies.

    - If trust_proxy_headers: respect X-Forwarded-Proto
    - Else: use Starlette scheme
    """
    if settings.trust_proxy_headers:
        xfproto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
        if xfproto in ("https", "http"):
            return xfproto == "https"
    return (request.url.scheme or "").lower() == "https"


def client_ip(request: Request) -> str:
    """
    Returns a stable client identifier for rate limiting.

    - If OGX_TRUST_PROXY_HEADERS=true, use X-Forwarded-For and respect proxy_hops.
    - Else use request.client.host.
    """
    direct = request.client.host if request.client else "unknown"
    if not settings.trust_proxy_headers:
        return direct

    xff = request.headers.get("x-forwarded-for")
    if not xff:
        return direct

    parts = [p.strip() for p in xff.split(",") if p.strip()]
    if not parts:
        return direct

    # proxy_hops = number of trusted proxies at the end of the chain
    idx = max(0, len(parts) - (settings.proxy_hops + 1))
    return parts[idx] or direct


def _endpoint_limit(path: str) -> int:
    """
    Return per-endpoint request limit, else global default.
    """
    if path == "/import":
        return settings.rl_import_max
    if path.startswith("/ingest/"):
        return settings.rl_ingest_max
    if path == "/export.csv" or path.startswith("/export"):
        return settings.rl_export_max
    return settings.rl_max_requests


def _rl_bucket_key(request: Request) -> str:
    """
    Reduce bucket explosion:
    - Group paths into stable buckets instead of using full path with IDs.
    - Keep method in the key.
    """
    path = request.url.path or ""
    method = request.method.upper()

    # Treat OPTIONS as "free" (preflight noise), never rate limit
    if method == "OPTIONS":
        return ""

    # Group dynamic paths
    if path.startswith("/player/"):
        path = "/player/*"
    elif path.startswith("/galaxy/"):
        path = "/galaxy/*"
    elif path.startswith("/admin/"):
        # admin endpoints should be few; keep prefix grouping
        path = "/admin/*"

    ip = client_ip(request) or "unknown"
    return f"{ip}:{path}:{method}"


# =============================================================================
# Password hashing (bcrypt)
# =============================================================================
try:
    import bcrypt  # type: ignore
except Exception:  # pragma: no cover
    bcrypt = None


def hash_password(plain: str) -> str:
    if bcrypt is None:
        raise RuntimeError("bcrypt is not installed. Add dependency 'bcrypt'.")
    plain_b = plain.encode("utf-8")
    salt = bcrypt.gensalt(rounds=settings.bcrypt_rounds)
    hashed = bcrypt.hashpw(plain_b, salt)
    return hashed.decode("utf-8")


def verify_password(plain: str, password_hash: str) -> bool:
    if bcrypt is None:
        raise RuntimeError("bcrypt is not installed. Add dependency 'bcrypt'.")
    try:
        return bool(bcrypt.checkpw(plain.encode("utf-8"), password_hash.encode("utf-8")))
    except Exception:
        return False


# =============================================================================
# JWT (HS256) — minimal, dependency-free, strict validation
# =============================================================================
def _jwt_signing_key() -> bytes:
    secret = settings.jwt_secret or settings.secret_key
    if not secret:
        raise RuntimeError("JWT secret missing (set OGX_JWT_SECRET).")
    return secret.encode("utf-8")


def _jwt_encode(payload: dict) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    header_b = _b64url_bytes(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b = _b64url_bytes(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b}.{payload_b}".encode("utf-8")
    sig = hmac.new(_jwt_signing_key(), signing_input, hashlib.sha256).digest()
    sig_b = _b64url_bytes(sig)
    return f"{header_b}.{payload_b}.{sig_b}"


def _jwt_decode(token: str) -> dict:
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
    except ValueError:
        raise ValueError("jwt_format")

    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    expected = hmac.new(_jwt_signing_key(), signing_input, hashlib.sha256).digest()

    try:
        actual = _b64url_decode(sig_b64)
    except Exception:
        raise ValueError("jwt_bad_signature")

    if not hmac.compare_digest(expected, actual):
        raise ValueError("jwt_bad_signature")

    try:
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except Exception:
        raise ValueError("jwt_bad_payload")

    return payload


def create_access_token(*, user: User) -> str:
    now = int(time.time())
    exp = now + int(settings.jwt_access_minutes) * 60
    payload = {
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": now,
        "exp": exp,
        "sub": str(user.id),
        "adm": bool(user.is_admin),
        "tv": int(user.token_version),
    }
    return _jwt_encode(payload)


def _extract_bearer_token(request: Request) -> Optional[str]:
    raw = request.headers.get(AUTH_HEADER)
    if not raw:
        return None
    raw = raw.strip()
    if not raw.lower().startswith("bearer "):
        return None
    return raw.split(" ", 1)[1].strip() or None


def _validate_jwt_claims(payload: dict) -> Tuple[int, bool, int]:
    """
    Returns (user_id, is_admin, token_version)
    """
    now = int(time.time())
    leeway = 10  # seconds clock-skew tolerance

    if payload.get("iss") != settings.jwt_issuer:
        raise ValueError("jwt_bad_iss")
    if payload.get("aud") != settings.jwt_audience:
        raise ValueError("jwt_bad_aud")

    exp = payload.get("exp")
    if not isinstance(exp, int) or exp <= (now - leeway):
        raise ValueError("jwt_expired")

    iat = payload.get("iat")
    if not isinstance(iat, int) or iat > (now + leeway):
        raise ValueError("jwt_bad_iat")

    sub = payload.get("sub")
    try:
        user_id = int(sub)
    except Exception:
        raise ValueError("jwt_bad_sub")

    is_admin = bool(payload.get("adm", False))

    tv = payload.get("tv")
    if not isinstance(tv, int) or tv < 0:
        raise ValueError("jwt_bad_tv")

    return user_id, is_admin, tv


async def get_user_by_id(db: AsyncSession, user_id: int) -> Optional[User]:
    res = await db.execute(select(User).where(User.id == user_id))
    return res.scalar_one_or_none()


async def require_jwt_user(
    request: Request,
    db: AsyncSession,
    *,
    require_admin: bool = False,
) -> Tuple[Optional[User], Optional[Response]]:
    token = _extract_bearer_token(request)
    if not token:
        return None, JSONResponse({"ok": False, "error": "missing_bearer_token"}, status_code=401)

    try:
        payload = _jwt_decode(token)
        user_id, token_is_admin, token_version = _validate_jwt_claims(payload)
    except ValueError as e:
        return None, JSONResponse({"ok": False, "error": str(e)}, status_code=401)

    user = await get_user_by_id(db, user_id)
    if not user:
        return None, JSONResponse({"ok": False, "error": "user_not_found"}, status_code=401)

    if not user.is_active:
        return None, JSONResponse({"ok": False, "error": "user_disabled"}, status_code=403)

    if user.token_version != token_version:
        return None, JSONResponse({"ok": False, "error": "token_revoked"}, status_code=401)

    if require_admin and not (user.is_admin and token_is_admin):
        return None, JSONResponse({"ok": False, "error": "admin_required"}, status_code=403)

    return user, None


# =============================================================================
# Rate limiting middleware (bounded memory)
# =============================================================================
@dataclass
class RateLimitState:
    window_start: float
    count: int
    last_seen: float


class SimpleRateLimitMiddleware(BaseHTTPMiddleware):
    """
    Minimal in-memory rate limiter with per-endpoint limits.

    Hardening:
    - bounded buckets via settings.rl_max_buckets
    - periodic cleanup (evict old/idle buckets)
    - path grouping to prevent bucket explosion
    - OPTIONS excluded (preflight)
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        self._buckets: dict[str, RateLimitState] = {}
        self._last_cleanup: float = 0.0

    def _maybe_cleanup(self, now: float) -> None:
        if now - self._last_cleanup < 5.0:
            return
        self._last_cleanup = now

        if not self._buckets:
            return

        window = float(settings.rl_window_seconds)
        expire_before = now - (window * 2.0)

        dead = [k for k, st in self._buckets.items() if st.last_seen < expire_before]
        for k in dead:
            self._buckets.pop(k, None)

        maxb = int(settings.rl_max_buckets)
        if len(self._buckets) > maxb:
            to_evict = len(self._buckets) - maxb
            oldest = sorted(self._buckets.items(), key=lambda kv: kv[1].last_seen)[:to_evict]
            for k, _st in oldest:
                self._buckets.pop(k, None)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        key = _rl_bucket_key(request)
        if not key:
            return await call_next(request)  # OPTIONS etc.

        now = time.time()
        self._maybe_cleanup(now)

        path = request.url.path or ""
        limit = _endpoint_limit(path)
        window = float(settings.rl_window_seconds)

        st = self._buckets.get(key)
        if st is None or (now - st.window_start) > window:
            self._buckets[key] = RateLimitState(window_start=now, count=1, last_seen=now)
        else:
            st.count += 1
            st.last_seen = now
            if st.count > limit:
                return JSONResponse(
                    {"ok": False, "error": "rate_limited"},
                    status_code=429,
                    headers={"Retry-After": str(int(window))},
                )

        return await call_next(request)


class RequestIdLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        rid = request.headers.get("x-request-id") or _b64url(12)
        request.state.request_id = rid

        start = time.time()
        resp = await call_next(request)
        dur_ms = int((time.time() - start) * 1000)

        resp.headers["X-Request-Id"] = rid
        resp.headers["X-Response-Time-ms"] = str(dur_ms)
        return resp


class MaxSizeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        cl = request.headers.get("content-length")
        if cl:
            try:
                n = int(cl)
            except ValueError:
                return PlainTextResponse("invalid content-length", status_code=400)

            ctype = (request.headers.get("content-type") or "").lower()
            limit = settings.max_upload_bytes if "multipart/form-data" in ctype else settings.max_request_bytes
            if n > limit:
                return PlainTextResponse("request too large", status_code=413)

        return await call_next(request)


class CsrfMiddleware(BaseHTTPMiddleware):
    """
    Double-submit CSRF for browser UI forms.

    IMPORTANT:
    - Never call `await request.form()` in middleware for multipart uploads.
    - /import should use x-csrf-token header (import.js).
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path or ""

        # Bypass CSRF for API-like endpoints (collector + auth + link + bridge)
        if (path.startswith("/ingest/") or path.startswith("/auth/")
                or path.startswith("/api/link/") or path.startswith("/api/bridge/")):
            return await call_next(request)

        safe = request.method in ("GET", "HEAD", "OPTIONS")
        csrf_cookie = request.cookies.get(CSRF_COOKIE)

        if csrf_cookie:
            request.state.csrf_token = csrf_cookie

        # First GET: issue cookie
        if safe and not csrf_cookie:
            token = _b64url(32)
            request.state.csrf_token = token

            resp = await call_next(request)

            # IMPORTANT behind reverse proxy: secure should follow X-Forwarded-Proto
            secure_cookie = (_is_https_request(request) if settings.env == "prod" else False)

            resp.set_cookie(
                CSRF_COOKIE,
                token,
                max_age=60 * 60 * 24 * 30,
                httponly=True,
                secure=secure_cookie,
                samesite="strict",
                path="/",
            )
            return resp

        if not safe:
            if not csrf_cookie:
                return JSONResponse({"ok": False, "error": "csrf_missing_cookie"}, status_code=403)

            # Prefer header (safe for multipart)
            token = request.headers.get(CSRF_HEADER) or ""

            # Fallback for urlencoded only
            if not token:
                ctype = (request.headers.get("content-type") or "").lower()
                if "application/x-www-form-urlencoded" in ctype:
                    form = await request.form()
                    token = str(form.get("csrf_token") or "")

            if not token or not _consteq(token, csrf_cookie):
                return JSONResponse({"ok": False, "error": "csrf_invalid"}, status_code=403)

            request.state.csrf_token = csrf_cookie

        return await call_next(request)


# =============================================================================
# Ingest auth (transition)
# - Dev: open if ingest_require_key=False
# - Prod: accept either valid API key OR valid Bearer token
# =============================================================================
async def require_ingest_auth(request: Request, db: AsyncSession) -> Optional[Response]:
    if not settings.ingest_require_key:
        return None

    # Prefer Bearer token if present
    if _extract_bearer_token(request):
        _user, resp = await require_jwt_user(request, db, require_admin=False)
        return resp

    # Fallback legacy api key
    if not settings.ingest_api_key:
        return JSONResponse({"ok": False, "error": "server_misconfig_no_ingest_key"}, status_code=500)

    key = request.headers.get(APIKEY_HEADER)
    if not key or not _consteq(key, settings.ingest_api_key):
        return JSONResponse({"ok": False, "error": "unauthorized"}, status_code=401)

    return None


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        resp = await call_next(request)

        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        resp.headers["X-Frame-Options"] = "DENY"

        # Optional isolation headers (can break setups). Gate with env var.
        if os.getenv("OGX_ENABLE_ISOLATION_HEADERS") == "1":
            resp.headers["Cross-Origin-Opener-Policy"] = "same-origin"
            resp.headers["Cross-Origin-Resource-Policy"] = "same-origin"
            resp.headers["Cross-Origin-Embedder-Policy"] = "require-corp"

        if settings.env == "prod":
            resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        # CSP
        # Hardening extras:
        # - object-src 'none'
        # - frame-ancestors 'none' already blocks framing
        # - in prod you can optionally enforce upgrade-insecure-requests
        upgrade = " upgrade-insecure-requests;" if settings.env == "prod" and os.getenv("OGX_CSP_UPGRADE_INSECURE") == "1" else ""

        # NOTE:
        # - We keep script-src strict (no inline).
        # - We allow inline styles because the UI uses style attributes + JS style mutations.
        #   (Without 'unsafe-inline' for style-src, modern UIs break.)
        if settings.csp_mode == "strict":
            csp = (
                "default-src 'none';"
                " base-uri 'self';"
                " form-action 'self';"
                " frame-ancestors 'none';"
                " object-src 'none';"
                " img-src 'self';"
                " style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;"
                " font-src 'self' https://fonts.gstatic.com;"
                " script-src 'self';"
                " connect-src 'self';"
                + upgrade
            )
        else:
            csp = (
                "default-src 'none';"
                " base-uri 'self';"
                " form-action 'self';"
                " frame-ancestors 'none';"
                " object-src 'none';"
                " img-src 'self' data:;"
                " style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;"
                " font-src 'self' https://fonts.gstatic.com;"
                " script-src 'self';"
                " connect-src 'self';"
                + upgrade
            )

        resp.headers["Content-Security-Policy"] = csp
        return resp
