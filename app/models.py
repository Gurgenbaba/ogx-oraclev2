# app/models.py
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    String,
    Integer,
    Boolean,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    CheckConstraint,
    Index,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def utcnow_naive() -> datetime:
    """
    Store UTC as naive datetime consistently.
    We intentionally keep naive UTC for cross-db consistency with existing data.
    """
    return datetime.utcnow()


# Use a cross-dialect server-side default:
# - SQLite: CURRENT_TIMESTAMP yields UTC-ish (depends on system, but acceptable for server_default)
# - Postgres: CURRENT_TIMESTAMP is timezone-aware but stored into naive DateTime; ok for now
SERVER_NOW = text("CURRENT_TIMESTAMP")


class User(Base):
    """
    App account for authentication (JWT) and moderation permissions.

    Username normalization happens in code (strip + lower) before saving.
    """
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    username: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(100), nullable=False)

    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("1"))

    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=utcnow_naive,
        server_default=SERVER_NOW,
    )

    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        CheckConstraint("length(username) >= 3", name="ck_users_username_minlen"),
        CheckConstraint("length(username) <= 32", name="ck_users_username_maxlen"),
        CheckConstraint("token_version >= 0", name="ck_users_token_version_nonneg"),
        Index("ix_users_active_admin", "is_active", "is_admin"),
    )


class Player(Base):
    __tablename__ = "players"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)

    astro_level: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    colonies: Mapped[List["Colony"]] = relationship(
        back_populates="player",
        cascade="all, delete-orphan",
        order_by="Colony.galaxy, Colony.system, Colony.position",
        passive_deletes=True,  # ensures DB-level cascade is used where supported
    )

    __table_args__ = (
        CheckConstraint("astro_level IS NULL OR (astro_level >= 0 AND astro_level <= 200)", name="ck_players_astro"),
    )


class Colony(Base):
    __tablename__ = "colonies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    player_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("players.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    galaxy: Mapped[int] = mapped_column(Integer, nullable=False)
    system: Mapped[int] = mapped_column(Integer, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    planet_name: Mapped[str] = mapped_column(String(128), nullable=False, default="Colonie", server_default=text("'Colonie'"))

    is_main: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("0"))

    has_moon: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("0"))
    moon_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    ally: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)

    travel_hint_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=utcnow_naive,
        server_default=SERVER_NOW,
    )

    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual_add", server_default=text("'manual_add'"))

    player: Mapped["Player"] = relationship(back_populates="colonies")

    __table_args__ = (
        UniqueConstraint("player_id", "galaxy", "system", "position", name="uq_player_coords"),

        CheckConstraint("galaxy >= 1 AND galaxy <= 50", name="ck_colonies_galaxy"),
        CheckConstraint("system >= 1 AND system <= 1000", name="ck_colonies_system"),
        CheckConstraint("position >= 1 AND position <= 30", name="ck_colonies_position"),

        CheckConstraint("(has_moon = 1) OR (moon_name IS NULL)", name="ck_colonies_moon_consistency"),

        CheckConstraint(
            "travel_hint_minutes IS NULL OR (travel_hint_minutes >= 0 AND travel_hint_minutes <= 100000)",
            name="ck_colonies_travel_hint",
        ),

        Index("ix_colonies_gspos", "galaxy", "system", "position"),
        Index("ix_colonies_player_coords", "player_id", "galaxy", "system", "position"),
        Index("ix_colonies_player_main", "player_id", "is_main"),
        Index("ix_colonies_ally", "ally"),
    )


class GalaxyScan(Base):
    """Tracks when a system was last scanned."""
    __tablename__ = "galaxy_scans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    galaxy: Mapped[int] = mapped_column(Integer, nullable=False)
    system: Mapped[int] = mapped_column(Integer, nullable=False)

    scanned_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=utcnow_naive,
        server_default=SERVER_NOW,
    )

    planets_found: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))

    __table_args__ = (
        UniqueConstraint("galaxy", "system", name="uq_galaxy_system"),
        CheckConstraint("galaxy >= 1 AND galaxy <= 50", name="ck_scans_galaxy"),
        CheckConstraint("system >= 1 AND system <= 1000", name="ck_scans_system"),
        CheckConstraint("planets_found >= 0 AND planets_found <= 10000", name="ck_scans_planets_found"),
        Index("ix_scans_gs", "galaxy", "system"),
        Index("ix_scans_scanned_at", "scanned_at"),
    )