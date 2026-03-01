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

    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))

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

    # FIX: default changed from "Colonie" (French) to "Colony" (English)
    planet_name: Mapped[str] = mapped_column(String(128), nullable=False, default="Colony", server_default=text("'Colony'"))

    is_main: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    has_moon: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
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

        # FIX: bidirectional moon consistency —
        # (1) if has_moon=true, moon_name must not be null
        # (2) if has_moon=false, moon_name must be null
        # This prevents orphaned moon_name values when has_moon=false.
        CheckConstraint(
            "(has_moon AND moon_name IS NOT NULL) OR (NOT has_moon AND moon_name IS NULL)",
            name="ck_colonies_moon_consistency",
        ),

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

# ═══════════════════════════════════════════════════════════════════════════
# PRESTIGE SYSTEM — shared with OGX Oracle
# ═══════════════════════════════════════════════════════════════════════════

class OPTransaction(Base):
    """Immutable audit log of every Oracle Points change."""
    __tablename__ = "op_transactions"

    id:         Mapped[int]           = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id:    Mapped[int]           = mapped_column(Integer, nullable=False, index=True)
    amount:     Mapped[int]           = mapped_column(Integer, nullable=False)
    reason:     Mapped[str]           = mapped_column(String(64), nullable=False, index=True)
    source_app: Mapped[str]           = mapped_column(String(16), nullable=False)
    ref_id:     Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime]      = mapped_column(DateTime, nullable=False, default=_now, server_default=SERVER_NOW)

    __table_args__ = (
        CheckConstraint("amount != 0", name="ck_op_amount_nonzero"),
        Index("ix_op_user_created", "user_id", "created_at"),
        Index("ix_op_reason", "reason"),
    )


class UserPrestige(Base):
    """Denormalized prestige summary per user. Updated on each OP award."""
    __tablename__ = "user_prestige"

    user_id:            Mapped[int]            = mapped_column(Integer, primary_key=True)
    total_op:           Mapped[int]            = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    prestige_rank:      Mapped[str]            = mapped_column(String(24), nullable=False, default="Cadet", server_default=text("'Cadet'"))
    scanner_title:      Mapped[Optional[str]]  = mapped_column(String(32), nullable=True)
    expo_count:         Mapped[int]            = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    scan_count:         Mapped[int]            = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    smuggler_count:     Mapped[int]            = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    last_active_date:   Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    current_streak:     Mapped[int]            = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    longest_streak:     Mapped[int]            = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    streak_milestone_7_claimed:  Mapped[bool]  = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    streak_milestone_30_claimed: Mapped[bool]  = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    updated_at:         Mapped[datetime]       = mapped_column(DateTime, nullable=False, default=_now, server_default=SERVER_NOW)

    __table_args__ = (
        CheckConstraint("total_op >= 0", name="ck_prestige_op_nonneg"),
        CheckConstraint("current_streak >= 0", name="ck_prestige_streak_nonneg"),
        Index("ix_prestige_total_op", "total_op"),
        Index("ix_prestige_rank", "prestige_rank"),
        {"extend_existing": True},
    )


class Achievement(Base):
    __tablename__ = "achievements"

    id:          Mapped[int]  = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug:        Mapped[str]  = mapped_column(String(64), unique=True, nullable=False)
    category:    Mapped[str]  = mapped_column(String(32), nullable=False, index=True)
    name:        Mapped[str]  = mapped_column(String(64), nullable=False)
    description: Mapped[str]  = mapped_column(String(255), nullable=False)
    icon:        Mapped[str]  = mapped_column(String(16), nullable=False)
    op_reward:   Mapped[int]  = mapped_column(Integer, nullable=False, default=0)
    threshold:   Mapped[int]  = mapped_column(Integer, nullable=False, default=0)
    hidden:      Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))

    __table_args__ = {"extend_existing": True}


class UserAchievement(Base):
    __tablename__ = "user_achievements"

    id:             Mapped[int]      = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id:        Mapped[int]      = mapped_column(Integer, nullable=False, index=True)
    achievement_id: Mapped[int]      = mapped_column(Integer, nullable=False, index=True)
    unlocked_at:    Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now, server_default=SERVER_NOW)

    __table_args__ = (
        UniqueConstraint("user_id", "achievement_id", name="uq_user_achievement"),
        Index("ix_ua_user", "user_id"),
    )


class LeaderboardSnapshot(Base):
    __tablename__ = "leaderboard_snapshots"

    id:         Mapped[int]      = mapped_column(Integer, primary_key=True, autoincrement=True)
    period:     Mapped[str]      = mapped_column(String(16), nullable=False)
    period_key: Mapped[str]      = mapped_column(String(16), nullable=False)
    user_id:    Mapped[int]      = mapped_column(Integer, nullable=False)
    rank:       Mapped[int]      = mapped_column(Integer, nullable=False)
    op_earned:  Mapped[int]      = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now, server_default=SERVER_NOW)

    __table_args__ = (
        UniqueConstraint("period", "period_key", "user_id", name="uq_snapshot_period_user"),
        Index("ix_snapshot_period", "period", "period_key"),
    )


