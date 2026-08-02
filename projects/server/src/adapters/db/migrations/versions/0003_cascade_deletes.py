"""foreign keys cascade on delete

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-02 12:00:00.000000

Deleting a project must remove its work items, their runs, and those runs' events.
Until now SQLite never enforced any of this (`PRAGMA foreign_keys` defaults to OFF);
with the pragma turned on in `adapters/db/engine.py`, the default `NO ACTION` would
instead *refuse* `DELETE /projects/{id}` for any project that has work items. Spec §4
promises that deleting a project leaves the operator's folder on disk alone — it
promises nothing about orphaned database rows.

SQLite cannot ALTER a foreign-key constraint, so each affected table is recreated and
copied by `batch_alter_table`. `copy_from` spells the current schema out rather than
reflecting it, so this migration keeps working even after `orm.py` moves on.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NOW = sa.text("(CURRENT_TIMESTAMP)")

# One entry per constraint being replaced: (table, column, target table, target column).
_FOREIGN_KEYS = (
    ("work_items", "project_id", "projects", "id"),
    ("runs", "project_id", "projects", "id"),
    ("runs", "work_item_id", "work_items", "id"),
    ("run_events", "run_id", "runs", "id"),
)


def _constraint_name(table: str, column: str) -> str:
    return f"fk_{table}_{column}"


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=_NOW, nullable=False),
    ]


def _tables(ondelete: str | None) -> dict[str, sa.Table]:
    """The three child tables as they stand *before* this migration runs in the given
    direction — `ondelete` describes the constraint currently on disk, which the batch
    operation below drops and replaces."""
    metadata = sa.MetaData()

    def fk(
        table: str, column: str, target_table: str, target_column: str
    ) -> sa.ForeignKeyConstraint:
        return sa.ForeignKeyConstraint(
            [column],
            [f"{target_table}.{target_column}"],
            name=_constraint_name(table, column),
            ondelete=ondelete,
        )

    work_items = sa.Table(
        "work_items",
        metadata,
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("key", sa.String(length=20), nullable=False),
        sa.Column("project_id", sa.String(length=32), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("priority", sa.String(length=20), nullable=False),
        sa.Column("epic_id", sa.String(length=32), nullable=True),
        sa.Column("feature_id", sa.String(length=32), nullable=True),
        sa.Column("spec", sa.Text(), nullable=True),
        sa.Column("sequence", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
        fk("work_items", "project_id", "projects", "id"),
    )
    runs = sa.Table(
        "runs",
        metadata,
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("project_id", sa.String(length=32), nullable=False),
        sa.Column("work_item_id", sa.String(length=32), nullable=False),
        sa.Column("agent_name", sa.String(length=200), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("started_at", sa.DateTime(), server_default=_NOW, nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        fk("runs", "project_id", "projects", "id"),
        fk("runs", "work_item_id", "work_items", "id"),
    )
    run_events = sa.Table(
        "run_events",
        metadata,
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("run_id", sa.String(length=32), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        fk("run_events", "run_id", "runs", "id"),
    )
    return {"work_items": work_items, "runs": runs, "run_events": run_events}


def _rewrite(from_ondelete: str | None, to_ondelete: str | None) -> None:
    tables = _tables(from_ondelete)
    # Children before parents: work_items is itself referenced by runs, so recreating
    # it last would leave the copied runs rows pointing at a table mid-swap.
    for table_name in ("run_events", "runs", "work_items"):
        constraints = [entry for entry in _FOREIGN_KEYS if entry[0] == table_name]
        with op.batch_alter_table(table_name, copy_from=tables[table_name]) as batch_op:
            for _, column, target_table, target_column in constraints:
                name = _constraint_name(table_name, column)
                batch_op.drop_constraint(name, type_="foreignkey")
                batch_op.create_foreign_key(
                    name, target_table, [column], [target_column], ondelete=to_ondelete
                )


def upgrade() -> None:
    """Upgrade schema."""
    _rewrite(from_ondelete=None, to_ondelete="CASCADE")


def downgrade() -> None:
    """Downgrade schema."""
    _rewrite(from_ondelete="CASCADE", to_ondelete=None)
