"""work items carry an assigned agent

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-02 16:00:00.000000

Spec decision 18. The design shows an assigned agent on every list row, kanban card
and detail header; without a column the UI would render that avatar from nothing.

Deliberately not a foreign key. Agents are folder-backed and never stored in this
database (spec §4), so this holds a name that can stop resolving when a folder is
renamed — the same condition `GET /agents` already reports as a Disabled agent.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("work_items", sa.Column("agent_name", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("work_items", "agent_name")
