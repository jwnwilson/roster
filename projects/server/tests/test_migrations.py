import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

SERVER_ROOT = Path(__file__).resolve().parents[1]

SEED = """
INSERT INTO projects (id, name, source_kind, folder_path)
    VALUES ('p1', 'P', 'none', '/tmp/p1');
INSERT INTO work_items (id, key, project_id, type, title, status, priority, sequence)
    VALUES ('w1', 'ROS-1', 'p1', 'task', 'T', 'backlog', 'medium', 1);
INSERT INTO runs (id, project_id, work_item_id, agent_name, status)
    VALUES ('r1', 'p1', 'w1', 'atlas', 'complete');
INSERT INTO run_events (id, run_id, type, message, created_at)
    VALUES ('e1', 'r1', 'status', 'hi', '2026-08-02 00:00:00');
INSERT INTO threads (id, project_id, work_item_id, title, status, read)
    VALUES ('t1', 'p1', 'w1', 'Set up CI', 'info', 0);
INSERT INTO threads (id, project_id, work_item_id, title, status, read)
    VALUES ('t2', 'p1', NULL, 'Plan the quarter', 'info', 0);
INSERT INTO messages (id, thread_id, author_kind, author_name, kind, content, created_at)
    VALUES ('m1', 't1', 'agent', 'atlas', 'text', 'starting', '2026-08-02 00:00:00');
"""

# The tables that exist at revision 0002, which is as far back as the round-trip
# test below goes. Threads and messages arrive in 0004 and are counted separately.
TABLES = ("projects", "work_items", "runs", "run_events")

ALL_TABLES = (*TABLES, "threads", "messages")


def _alembic(data_root: Path, *args: str) -> None:
    # A subprocess, not alembic's Python API: env.py drives migrations with
    # asyncio.run(), which raises if there is already a running event loop — and
    # under pytest-asyncio's auto mode there always is.
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=SERVER_ROOT,
        env={**os.environ, "ROSTER_DATA_ROOT": str(data_root)},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def _counts(data_root: Path, tables: tuple[str, ...] = TABLES) -> dict[str, int]:
    with sqlite3.connect(data_root / "roster.db") as connection:
        return {t: connection.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in tables}


@pytest.fixture
def migrated(tmp_path):
    _alembic(tmp_path, "upgrade", "head")
    with sqlite3.connect(tmp_path / "roster.db") as connection:
        connection.executescript(SEED)
    return tmp_path


def test_the_cascade_migration_round_trips_without_losing_rows(migrated):
    # Arrange — migration 0003 recreates and copies three tables in each
    # direction, which is exactly where rows get dropped silently.
    before = _counts(migrated)
    assert before == {"projects": 1, "work_items": 1, "runs": 1, "run_events": 1}

    # Act
    _alembic(migrated, "downgrade", "0002")
    after_downgrade = _counts(migrated)
    _alembic(migrated, "upgrade", "head")

    # Assert
    assert after_downgrade == before
    assert _counts(migrated) == before


def test_deleting_a_project_cascades_on_the_migrated_schema(migrated):
    # Arrange / Act — the migrated schema, not the metadata.create_all one every
    # other test uses: those two can drift, and only this one ships.
    with sqlite3.connect(migrated / "roster.db") as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("DELETE FROM projects WHERE id = 'p1'")

    # Assert
    assert _counts(migrated, ALL_TABLES) == {
        "projects": 0, "work_items": 0, "runs": 0, "run_events": 0,
        "threads": 0, "messages": 0,
    }


def test_the_threads_migration_round_trips(migrated):
    # Arrange — 0004 creates two tables; going back and forward again must leave
    # the pre-existing tables untouched and rebuild the new ones cleanly.
    before = _counts(migrated)

    # Act
    _alembic(migrated, "downgrade", "0003")
    after_downgrade = _counts(migrated)
    _alembic(migrated, "upgrade", "head")

    # Assert — the older tables never lost a row, and the new ones come back empty
    # (a create-table migration has nothing to restore, which is the honest result).
    assert after_downgrade == before
    assert _counts(migrated, ALL_TABLES) == {**before, "threads": 0, "messages": 0}


def test_a_thread_may_outlive_its_work_item_by_having_none(migrated):
    # The nullable work_item_id is load-bearing (spec §4): it is what lets the
    # lead-agent conversation exist at all. A NOT NULL here would be silent until
    # the chat panel had nothing to attach to.
    with sqlite3.connect(migrated / "roster.db") as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("DELETE FROM work_items WHERE id = 'w1'")

        remaining = connection.execute(
            "SELECT id FROM threads ORDER BY id"
        ).fetchall()

    # t1 was scoped to the deleted work item and cascades; t2 has none and survives.
    assert remaining == [("t2",)]
