"""
cleanup_db.py — OGX Oracle SQLite Cleanup (safe by default)

Run examples:
  python cleanup_db.py --stats
  python cleanup_db.py --orphans
  python cleanup_db.py --orphans --apply
  python cleanup_db.py --delete-player "Mars" --apply
  python cleanup_db.py --dupes --apply

Safety:
- Default is DRY RUN (no writes). Use --apply to actually modify DB.
- Creates a backup copy ogx.db.bak.<timestamp> before applying changes.
- Uses BEGIN IMMEDIATE transaction to avoid partial state.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Dict, Tuple, Optional


# Default DB path: project root / ogx.db
DEFAULT_DB_PATH = Path(__file__).resolve().parent / "ogx.db"


# -----------------------------
# Helpers
# -----------------------------
def utc_stamp() -> str:
    return datetime.utcnow().strftime("%Y%m%d_%H%M%S")


def normalize_player_name(name: str) -> str:
    """
    Normalize for dup-detection:
    - strip status suffix like "(n)", "(i n)", "(A)", etc.
    - normalize whitespace
    - lowercase
    """
    raw = (name or "").strip()
    raw = re.sub(r"\s*\([^)]*\)\s*$", "", raw).strip()
    raw = " ".join(raw.split())
    return raw.lower()


def connect(db_path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON;")
    con.execute("PRAGMA busy_timeout = 8000;")
    return con


def table_exists(con: sqlite3.Connection, name: str) -> bool:
    row = con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?;",
        (name,),
    ).fetchone()
    return row is not None


def require_schema(con: sqlite3.Connection) -> None:
    needed = {"players", "colonies"}
    missing = [t for t in needed if not table_exists(con, t)]
    if missing:
        raise RuntimeError(f"DB schema missing tables: {', '.join(missing)}")


def show_stats(con: sqlite3.Connection) -> None:
    players = con.execute("SELECT COUNT(*) FROM players;").fetchone()[0]
    colonies = con.execute("SELECT COUNT(*) FROM colonies;").fetchone()[0]
    print(f"DB: {players} Spieler, {colonies} Kolonien")


def backup_db(db_path: Path) -> Path:
    bak = db_path.with_name(f"{db_path.name}.bak.{utc_stamp()}")
    shutil.copy2(db_path, bak)
    return bak


# -----------------------------
# Operations
# -----------------------------
def find_orphan_players(con: sqlite3.Connection) -> List[sqlite3.Row]:
    return con.execute(
        """
        SELECT p.id, p.name
        FROM players p
        WHERE NOT EXISTS (
          SELECT 1 FROM colonies c WHERE c.player_id = p.id
        )
        ORDER BY p.name;
        """
    ).fetchall()


def delete_player_by_name(con: sqlite3.Connection, name: str) -> Tuple[bool, int]:
    row = con.execute("SELECT id FROM players WHERE name = ?;", (name,)).fetchone()
    if not row:
        return False, 0
    pid = int(row["id"])
    cols = con.execute("DELETE FROM colonies WHERE player_id = ?;", (pid,)).rowcount
    con.execute("DELETE FROM players WHERE id = ?;", (pid,))
    return True, int(cols)


def delete_orphan_players(con: sqlite3.Connection) -> int:
    orphans = find_orphan_players(con)
    for o in orphans:
        con.execute("DELETE FROM players WHERE id = ?;", (int(o["id"]),))
    return len(orphans)


def find_duplicate_players(con: sqlite3.Connection) -> Dict[str, List[Dict]]:
    """
    Returns groups keyed by normalized name with list of {id, name, colonies_count}.
    """
    rows = con.execute("SELECT id, name FROM players ORDER BY name;").fetchall()
    groups: Dict[str, List[Dict]] = {}

    for r in rows:
        pid = int(r["id"])
        nm = str(r["name"] or "")
        key = normalize_player_name(nm)
        groups.setdefault(key, []).append({"id": pid, "name": nm})

    # attach colony counts
    for key, arr in groups.items():
        for p in arr:
            cnt = con.execute("SELECT COUNT(*) FROM colonies WHERE player_id = ?;", (p["id"],)).fetchone()[0]
            p["colonies"] = int(cnt)

    return {k: v for k, v in groups.items() if len(v) > 1}


def merge_players(con: sqlite3.Connection, keep_id: int, delete_ids: List[int]) -> Tuple[int, int]:
    """
    Moves colonies from delete_ids -> keep_id.
    If a colony with same coords exists for keep_id, the duplicate is deleted.
    Returns (moved_count, deleted_dupe_colonies_count).
    """
    existing = {
        (int(r["galaxy"]), int(r["system"]), int(r["position"]))
        for r in con.execute(
            "SELECT galaxy, system, position FROM colonies WHERE player_id = ?;",
            (keep_id,),
        )
    }

    moved = 0
    deleted_dupes = 0

    for did in delete_ids:
        to_move = con.execute("SELECT id, galaxy, system, position FROM colonies WHERE player_id = ?;", (did,)).fetchall()
        for c in to_move:
            cid = int(c["id"])
            coord = (int(c["galaxy"]), int(c["system"]), int(c["position"]))
            if coord in existing:
                con.execute("DELETE FROM colonies WHERE id = ?;", (cid,))
                deleted_dupes += 1
            else:
                con.execute("UPDATE colonies SET player_id = ? WHERE id = ?;", (keep_id, cid))
                existing.add(coord)
                moved += 1

        con.execute("DELETE FROM players WHERE id = ?;", (did,))

    return moved, deleted_dupes


def find_bad_coords(con: sqlite3.Connection) -> List[sqlite3.Row]:
    return con.execute(
        """
        SELECT c.id, p.name, c.galaxy, c.system, c.position
        FROM colonies c
        JOIN players p ON p.id = c.player_id
        WHERE c.galaxy <= 0 OR c.system <= 0 OR c.position <= 0
        ORDER BY p.name;
        """
    ).fetchall()


def delete_bad_coords(con: sqlite3.Connection) -> int:
    bad = find_bad_coords(con)
    for b in bad:
        con.execute("DELETE FROM colonies WHERE id = ?;", (int(b["id"]),))
    return len(bad)


# -----------------------------
# CLI / Main
# -----------------------------
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="OGX Oracle DB cleanup (SQLite) — safe by default")
    p.add_argument("--db", type=str, default=str(DEFAULT_DB_PATH), help="Path to ogx.db (default: ./ogx.db)")
    p.add_argument("--apply", action="store_true", help="Actually apply changes (otherwise DRY RUN)")

    p.add_argument("--stats", action="store_true", help="Show basic stats")
    p.add_argument("--orphans", action="store_true", help="List orphan players (no colonies)")
    p.add_argument("--delete-orphans", action="store_true", help="Delete orphan players")

    p.add_argument("--dupes", action="store_true", help="List duplicate player groups (normalized)")
    p.add_argument("--merge", nargs="+", type=int, help="Merge players: --merge KEEP_ID DEL_ID1 DEL_ID2 ...")

    p.add_argument("--delete-player", type=str, help="Delete player by exact name (also deletes colonies)")
    p.add_argument("--bad-coords", action="store_true", help="List colonies with invalid coords (<=0)")
    p.add_argument("--delete-bad-coords", action="store_true", help="Delete colonies with invalid coords (<=0)")

    return p.parse_args()


def main() -> int:
    args = parse_args()
    db_path = Path(args.db).resolve()

    if not db_path.exists():
        print(f"[ERROR] DB not found: {db_path}")
        return 1

    con = connect(db_path)
    try:
        require_schema(con)

        print("=" * 62)
        print("OGX Oracle — DB Cleanup (SQLite)")
        print("=" * 62)
        print(f"DB Path: {db_path}")
        print(f"Mode: {'APPLY' if args.apply else 'DRY RUN'}")
        show_stats(con)
        print("-" * 62)

        # Read-only operations
        if args.orphans:
            orphans = find_orphan_players(con)
            if not orphans:
                print("No orphan players.")
            else:
                print(f"Orphan players ({len(orphans)}):")
                for o in orphans:
                    print(f"  - {o['name']} (id={o['id']})")

        if args.dupes:
            dupes = find_duplicate_players(con)
            if not dupes:
                print("No duplicate groups.")
            else:
                print(f"Duplicate groups ({len(dupes)}):")
                for k, group in dupes.items():
                    print(f"  Group: '{k}'")
                    for p in group:
                        print(f"    - id={p['id']}  name='{p['name']}'  colonies={p['colonies']}")

        if args.bad_coords:
            bad = find_bad_coords(con)
            if not bad:
                print("No invalid coordinates.")
            else:
                print(f"Bad coords ({len(bad)}):")
                for b in bad:
                    print(f"  - {b['name']}: {b['galaxy']}:{b['system']}:{b['position']} (colony_id={b['id']})")

        # Write operations — guarded
        wants_write = any(
            [
                args.delete_orphans,
                args.merge is not None,
                args.delete_player is not None,
                args.delete_bad_coords,
            ]
        )

        if wants_write and not args.apply:
            print("\n[SAFEGUARD] Write operation requested but --apply is missing.")
            print("Add --apply to perform changes. Exiting without modifications.")
            return 0

        if wants_write and args.apply:
            bak = backup_db(db_path)
            print(f"\nBackup created: {bak}")

            try:
                con.execute("BEGIN IMMEDIATE;")

                if args.delete_player:
                    ok, cols = delete_player_by_name(con, args.delete_player)
                    if not ok:
                        print(f"[WARN] Player not found: '{args.delete_player}'")
                    else:
                        print(f"Deleted player '{args.delete_player}' and {cols} colonies.")

                if args.delete_orphans:
                    n = delete_orphan_players(con)
                    print(f"Deleted orphan players: {n}")

                if args.merge:
                    if len(args.merge) < 2:
                        raise ValueError("--merge requires: KEEP_ID DEL_ID1 [DEL_ID2 ...]")
                    keep = int(args.merge[0])
                    dels = [int(x) for x in args.merge[1:]]
                    moved, deleted_dupes = merge_players(con, keep, dels)
                    print(f"Merged into keep_id={keep}: moved={moved}, deleted_dupe_colonies={deleted_dupes}, deleted_players={len(dels)}")

                if args.delete_bad_coords:
                    n = delete_bad_coords(con)
                    print(f"Deleted bad-coord colonies: {n}")

                con.commit()
                print("\n✅ Changes committed.")
            except Exception as e:
                con.rollback()
                print("\n❌ ERROR — rolled back. Reason:", str(e))
                print("Your DB is unchanged. Backup is available above.")
                return 1

        print("-" * 62)
        show_stats(con)
        print("Done.")
        return 0

    finally:
        con.close()


if __name__ == "__main__":
    raise SystemExit(main())