"""threads and messages

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-02 14:00:00.000000

The thread is roster's unit of agent work (spec §4, decision 16). It belongs to a
project and *optionally* to a work item — that nullable `work_item_id` is what lets
the design's three thread surfaces (the lead-agent chat panel, a work item's Thread
tab, and the global Threads screen) share one table and one resolution rule.

Both foreign keys cascade from the outset, matching what 0003 had to retrofit onto
the older tables: deleting a project takes its threads and their messages with it.

`messages.created_at` is written by the caller rather than defaulted by the database.
SQLite's CURRENT_TIMESTAMP has only second resolution, which would tie-break messages
written inside the same second — and the message endpoints order by it.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NOW = sa.text("(CURRENT_TIMESTAMP)")


def upgrade() -> None:
    op.create_table(
        "threads",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("project_id", sa.String(32), nullable=False),
        sa.Column("work_item_id", sa.String(32), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="info"),
        sa.Column("read", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(), server_default=_NOW),
        sa.Column("updated_at", sa.DateTime(), server_default=_NOW),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["work_item_id"], ["work_items.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_threads_project_id", "threads", ["project_id"])
    op.create_index("ix_threads_work_item_id", "threads", ["work_item_id"])

    op.create_table(
        "messages",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("thread_id", sa.String(32), nullable=False),
        sa.Column("author_kind", sa.String(10), nullable=False),
        sa.Column("author_name", sa.String(200), nullable=True),
        sa.Column("kind", sa.String(20), nullable=False, server_default="text"),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["thread_id"], ["threads.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_messages_thread_id", "messages", ["thread_id"])


def downgrade() -> None:
    # messages first: its foreign key points at threads.
    op.drop_index("ix_messages_thread_id", table_name="messages")
    op.drop_table("messages")
    op.drop_index("ix_threads_work_item_id", table_name="threads")
    op.drop_index("ix_threads_project_id", table_name="threads")
    op.drop_table("threads")
