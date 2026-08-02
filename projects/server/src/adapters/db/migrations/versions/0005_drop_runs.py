"""drop the run tables

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-02 15:00:00.000000

Spec decision 16 removed the run entity: the unit of agent work is a turn inside a
thread, and the messages that turn writes are its only record. A turn is an asyncio
task with no persisted identity, so there is nothing to migrate these rows *into* —
this is a drop, not a rename.

`run_events` goes first: its foreign key points at `runs`.

The downgrade recreates both tables so this migration is reversible like every
other one in this tree, but it cannot bring the rows back. That is honest rather
than unfortunate — downgrading past the removal of a concept gets you the schema,
not the history.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NOW = sa.text("(CURRENT_TIMESTAMP)")


def upgrade() -> None:
    op.drop_table("run_events")
    op.drop_table("runs")


def downgrade() -> None:
    op.create_table(
        "runs",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("project_id", sa.String(32), nullable=False),
        sa.Column("work_item_id", sa.String(32), nullable=False),
        sa.Column("agent_name", sa.String(200), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="running"),
        sa.Column("started_at", sa.DateTime(), server_default=_NOW),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["work_item_id"], ["work_items.id"], ondelete="CASCADE"),
    )
    op.create_table(
        "run_events",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("run_id", sa.String(32), nullable=False),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
    )
