# app/settings.py
from __future__ import annotations

import os
import secrets
from typing import Literal, Optional

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

EnvName = Literal["dev", "prod"]
CspMode = Literal["strict", "pragmatic"]


class Settings(BaseSettings):
    """
    Security-by-default settings.

    RULES:
    - Never ship real secrets as code defaults.
    - In prod: secrets MUST be provided via environment (or secret manager).
    - In dev: secrets may be auto-generated for convenience (ephemeral).
    """

    model_config = SettingsConfigDict(
        env_prefix="OGX_",
        env_file=".env",
        extra="ignore",
    )

    # ------------------------------------------------------------
    # App
    # ------------------------------------------------------------
    env: EnvName = Field(default="dev")
    bind_host: str = Field(default="127.0.0.1")
    bind_port: int = Field(default=8000, ge=1, le=65535)

    # ------------------------------------------------------------
    # Database
    # ------------------------------------------------------------
    # For Railway/Render set: OGX_DATABASE_URL=postgres://...
    # (db.py will normalize to postgresql+asyncpg://...)
    database_url: Optional[str] = Field(default=None, repr=False)

    # ------------------------------------------------------------
    # Secrets (NEVER commit)
    # ------------------------------------------------------------
    # Used for signing cookies/CSP nonce seed/etc. (and can also be reused as fallback JWT secret)
    secret_key: str | None = Field(default=None, repr=False)

    # ------------------------------------------------------------
    # Auth / JWT
    # ------------------------------------------------------------
    # In prod you MUST set OGX_JWT_SECRET (separate from app secret_key)
    jwt_secret: str | None = Field(default=None, repr=False)
    jwt_issuer: str = Field(default="ogx-oracle")
    jwt_audience: str = Field(default="ogx-oracle-users")

    # Minutes for access token lifetime (keep short; no refresh token yet)
    jwt_access_minutes: int = Field(default=60, ge=5, le=7 * 24 * 60)  # 5min..7days

    # Password policy (validated in code; DB stores only hash)
    username_min_len: int = Field(default=3, ge=2, le=32)
    username_max_len: int = Field(default=32, ge=3, le=64)
    password_min_len: int = Field(default=10, ge=6, le=128)

    # bcrypt cost (work factor)
    bcrypt_rounds: int = Field(default=12, ge=10, le=16)

    # Open registration control
    allow_registration: bool = Field(default=True)

    # If true, the FIRST registered user becomes admin (only when no users exist).
    bootstrap_first_user_admin: bool = Field(default=True)

    # ------------------------------------------------------------
    # Legacy ingest auth (transition)
    # ------------------------------------------------------------
    # In prod: ingest_require_key forced True (accepts Bearer JWT too, see security.py)
    ingest_require_key: bool = Field(default=False)
    ingest_api_key: str | None = Field(default=None, repr=False)

    # ------------------------------------------------------------
    # Security / limits
    # ------------------------------------------------------------
    max_request_bytes: int = Field(default=1_000_000, ge=1_000, le=50_000_000)
    max_upload_bytes: int = Field(default=2_000_000, ge=1_000, le=200_000_000)
    max_csv_rows: int = Field(default=25_000, ge=1, le=5_000_000)
    max_field_len: int = Field(default=512, ge=1, le=50_000)

    # Rate limiting (in-memory)
    rl_window_seconds: int = Field(default=10, ge=1, le=3600)
    rl_max_requests: int = Field(default=60, ge=1, le=1_000_000)
    rl_import_max: int = Field(default=5, ge=1, le=1_000)
    rl_ingest_max: int = Field(default=20, ge=1, le=1_000)
    rl_export_max: int = Field(default=10, ge=1, le=1_000)
    rl_max_buckets: int = Field(default=10_000, ge=100, le=500_000)

    # Proxy / IP trust
    trust_proxy_headers: bool = Field(default=False)
    proxy_hops: int = Field(default=1, ge=1, le=10)

    # SQLite concurrency
    sqlite_busy_timeout_ms: int = Field(default=10_000, ge=1_000, le=60_000)

    # CSP modes
    csp_mode: CspMode = Field(default="pragmatic")

    # ------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------
    @field_validator("bind_host")
    @classmethod
    def _validate_bind_host(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("bind_host must not be empty")
        return v

    @model_validator(mode="after")
    def _finalize_and_validate(self) -> "Settings":
        # --- DEV convenience: ephemeral secrets if missing ---
        if self.env == "dev":
            if not self.secret_key:
                self.secret_key = secrets.token_urlsafe(32)

            # JWT: in dev we allow auto-generated secret (ephemeral)
            if not self.jwt_secret:
                self.jwt_secret = secrets.token_urlsafe(48)

            # Only generate ingest key if we actually require it.
            if self.ingest_require_key and not self.ingest_api_key:
                self.ingest_api_key = secrets.token_urlsafe(32)

        # --- PROD hard requirements ---
        if self.env == "prod":
            # force secure defaults for old ingest gate (until collector is fully JWT)
            self.ingest_require_key = True

            if not self.secret_key:
                raise ValueError("OGX_SECRET_KEY is required in prod")

            # JWT secret must be set explicitly in prod
            if not self.jwt_secret:
                raise ValueError("OGX_JWT_SECRET is required in prod")

            if not self.ingest_api_key:
                raise ValueError("OGX_INGEST_API_KEY is required in prod")

            # Safety rail: discourage accidental open bind without reverse proxy.
            if self.bind_host == "0.0.0.0" and os.getenv("OGX_ALLOW_PUBLIC_BIND") != "1":
                raise ValueError(
                    "Refusing to bind 0.0.0.0 in prod without OGX_ALLOW_PUBLIC_BIND=1 "
                    "(use a reverse proxy / firewall rules)"
                )

        return self


settings = Settings()