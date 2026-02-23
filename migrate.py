"""
migrate.py — OGX Oracle SQLite migrations (no Alembic)

Run:
  python migrate.py

What it does (v2):
- Creates schema_migrations table
- Migrates players/colonies/galaxy_scans to strict schema:
  * UNIQUE constraints (player name, colony identity, scan identity)
  * CHECK constraints (ranges, astro bounds, moon consistency)
  * Composite indices for real queries
- Keeps existing data (best effort)
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from datetime import datetime

DB_PATH = Path(__file__).resolve().parent / "ogx.db"
TARGET_VERSION = 2


def utcnow_iso() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def table_exists(cur: sqlite3.Cursor, name: str) -> bool:
    cur.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?;", (name,))
    return cur.fetchone() is not None


def index_exists(cur: sqlite3.Cursor, name: str) -> bool:
    cur.execute("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?;", (name,))
    return cur.fetchone() is not None


def get_version(cur: sqlite3.Cursor) -> int:
    if not table_exists(cur, "schema_migrations"):
        return 0
    cur.execute("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1;")
    row = cur.fetchone()
    return int(row[0]) if row else 0


def set_version(cur: sqlite3.Cursor, version: int) -> None:
    cur.execute(
        "INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?);",
        (version, utcnow_iso()),
    )


def main() -> None:
    if not DB_PATH.exists():
        print(f"❌ DB not found: {DB_PATH}")
        raise SystemExit(1)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Safety pragmas for migration
    cur.execute("PRAGMA foreign_keys=OFF;")
    cur.execute("PRAGMA journal_mode=WAL;")
    cur.execute("PRAGMA synchronous=FULL;")
    cur.execute("PRAGMA busy_timeout=8000;")

    # schema_migrations
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version     INTEGER NOT NULL,
          applied_at  TEXT    NOT NULL,
          PRIMARY KEY(version)
        );
        """
    )

    current = get_version(cur)
    if current >= TARGET_VERSION:
        print(f"✅ schema already at version {current} (>= {TARGET_VERSION}) — nothing to do.")
        conn.close()
        return

    print(f"ℹ️  migrating schema v{current} -> v{TARGET_VERSION} ...")

    # Ensure base tables exist (older app versions used create_all)
    # If they don't exist, just create the new strict schema directly.
    has_players = table_exists(cur, "players")
    has_colonies = table_exists(cur, "colonies")
    has_scans = table_exists(cur, "galaxy_scans")

    # --- Create strict tables ---
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS players_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT    NOT NULL UNIQUE,
          astro_level INTEGER NULL,
          CONSTRAINT ck_players_astro CHECK (astro_level IS NULL OR (astro_level >= 0 AND astro_level <= 200))
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS colonies_new (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          player_id           INTEGER NOT NULL,
          galaxy              INTEGER NOT NULL,
          system              INTEGER NOT NULL,
          position            INTEGER NOT NULL,
          planet_name         TEXT    NOT NULL DEFAULT 'Colonie',
          is_main             INTEGER NOT NULL DEFAULT 0,
          has_moon            INTEGER NOT NULL DEFAULT 0,
          moon_name           TEXT    NULL,
          ally                TEXT    NULL,
          travel_hint_minutes INTEGER NULL,
          note                TEXT    NULL,
          last_seen_at        TEXT    NOT NULL DEFAULT (datetime('now')),
          source              TEXT    NOT NULL DEFAULT 'manual_add',

          CONSTRAINT fk_colonies_player FOREIGN KEY(player_id) REFERENCES players_new(id) ON DELETE CASCADE,

          CONSTRAINT uq_player_coords UNIQUE(player_id, galaxy, system, position),

          CONSTRAINT ck_colonies_galaxy   CHECK (galaxy >= 1 AND galaxy <= 50),
          CONSTRAINT ck_colonies_system   CHECK (system >= 1 AND system <= 1000),
          CONSTRAINT ck_colonies_position CHECK (position >= 1 AND position <= 30),

          CONSTRAINT ck_colonies_moon_consistency CHECK ((has_moon = 1) OR (moon_name IS NULL)),
          CONSTRAINT ck_colonies_travel_hint CHECK (travel_hint_minutes IS NULL OR (travel_hint_minutes >= 0 AND travel_hint_minutes <= 100000))
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS galaxy_scans_new (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          galaxy        INTEGER NOT NULL,
          system        INTEGER NOT NULL,
          scanned_at    TEXT    NOT NULL DEFAULT (datetime('now')),
          planets_found INTEGER NOT NULL DEFAULT 0,

          CONSTRAINT uq_galaxy_system UNIQUE(galaxy, system),
          CONSTRAINT ck_scans_galaxy CHECK (galaxy >= 1 AND galaxy <= 50),
          CONSTRAINT ck_scans_system CHECK (system >= 1 AND system <= 1000),
          CONSTRAINT ck_scans_planets_found CHECK (planets_found >= 0 AND planets_found <= 10000)
        );
        """
    )

    # --- Copy data (best effort) ---
    if has_players:
        cur.execute(
            """
            INSERT OR IGNORE INTO players_new(id, name, astro_level)
            SELECT id, TRIM(name), astro_level
            FROM players
            WHERE name IS NOT NULL AND TRIM(name) != '';
            """
        )

    if has_colonies and has_players:
        # Some old DBs might not have ally column — use COALESCE with a safe fallback
        # SQLite: selecting missing column errors. So detect columns.
        cur.execute("PRAGMA table_info(colonies);")
        cols = {row["name"] for row in cur.fetchall()}
        has_ally_col = "ally" in cols

        ally_select = "ally" if has_ally_col else "NULL AS ally"

        cur.execute(
            f"""
            INSERT OR IGNORE INTO colonies_new(
              id, player_id, galaxy, system, position,
              planet_name, is_main, has_moon, moon_name,
              ally, travel_hint_minutes, note, last_seen_at, source
            )
            SELECT
              c.id,
              c.player_id,
              CASE WHEN c.galaxy  IS NULL THEN 0 ELSE c.galaxy  END,
              CASE WHEN c.system  IS NULL THEN 0 ELSE c.system  END,
              CASE WHEN c.position IS NULL THEN 0 ELSE c.position END,
              COALESCE(NULLIF(TRIM(c.planet_name), ''), 'Colonie'),
              COALESCE(c.is_main, 0),
              COALESCE(c.has_moon, 0),
              NULLIF(TRIM(c.moon_name), ''),
              {ally_select},
              c.travel_hint_minutes,
              NULLIF(TRIM(c.note), ''),
              COALESCE(c.last_seen_at, datetime('now')),
              COALESCE(NULLIF(TRIM(c.source), ''), 'manual_add')
            FROM colonies c
            JOIN players_new p ON p.id = c.player_id
            WHERE
              c.galaxy BETWEEN 1 AND 50
              AND c.system BETWEEN 1 AND 1000
              AND c.position BETWEEN 1 AND 30;
            """
        )

    if has_scans:
        cur.execute(
            """
            INSERT OR IGNORE INTO galaxy_scans_new(id, galaxy, system, scanned_at, planets_found)
            SELECT
              id,
              galaxy,
              system,
              COALESCE(scanned_at, datetime('now')),
              COALESCE(planets_found, 0)
            FROM galaxy_scans
            WHERE galaxy BETWEEN 1 AND 50 AND system BETWEEN 1 AND 1000;
            """
        )

    # --- Swap tables ---
    # Keep backups with _old suffix (so we can rollback manually if needed)
    if has_players:
        cur.execute("ALTER TABLE players RENAME TO players_old;")
    if has_colonies:
        cur.execute("ALTER TABLE colonies RENAME TO colonies_old;")
    if has_scans:
        cur.execute("ALTER TABLE galaxy_scans RENAME TO galaxy_scans_old;")

    cur.execute("ALTER TABLE players_new RENAME TO players;")
    cur.execute("ALTER TABLE colonies_new RENAME TO colonies;")
    cur.execute("ALTER TABLE galaxy_scans_new RENAME TO galaxy_scans;")

    # --- Indices (composite, query-driven) ---
    if not index_exists(cur, "ix_colonies_gspos"):
        cur.execute("CREATE INDEX ix_colonies_gspos ON colonies(galaxy, system, position);")
    if not index_exists(cur, "ix_colonies_player_coords"):
        cur.execute("CREATE INDEX ix_colonies_player_coords ON colonies(player_id, galaxy, system, position);")
    if not index_exists(cur, "ix_colonies_player_main"):
        cur.execute("CREATE INDEX ix_colonies_player_main ON colonies(player_id, is_main);")
    if not index_exists(cur, "ix_colonies_ally"):
        cur.execute("CREATE INDEX ix_colonies_ally ON colonies(ally);")

    if not index_exists(cur, "ix_scans_gs"):
        cur.execute("CREATE INDEX ix_scans_gs ON galaxy_scans(galaxy, system);")
    if not index_exists(cur, "ix_scans_scanned_at"):
        cur.execute("CREATE INDEX ix_scans_scanned_at ON galaxy_scans(scanned_at);")

    # (Optional) enforce single main colony per player using partial unique index (SQLite supports it)
    # If you want this HARD enforced, uncomment:
    # if not index_exists(cur, "uq_one_main_per_player"):
    #     cur.execute("CREATE UNIQUE INDEX uq_one_main_per_player ON colonies(player_id) WHERE is_main = 1;")

    # record version
    set_version(cur, TARGET_VERSION)

    # Restore foreign keys
    cur.execute("PRAGMA foreign_keys=ON;")
    conn.commit()
    conn.close()

    print("✅ Migration complete.")
    print("ℹ️  Old tables kept as players_old / colonies_old / galaxy_scans_old for safety.")


if __name__ == "__main__":
    main()