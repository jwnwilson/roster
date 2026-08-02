"""Startup reconciliation of runs the previous process left in flight.

Spec §3 accepts that runs do not survive an API restart: "in-flight runs are
marked failed on startup and can be restarted from the UI". Without this, a run
the old process was executing stays `running` forever — and because the SSE loop
only exits on a terminal status, streaming that run polls the database until the
client gives up.
"""

import logging
from collections.abc import Callable
from datetime import UTC, datetime

from adapters.db.uow import AsyncUnitOfWork
from domain.ids import new_id
from domain.runs import RunEvent

logger = logging.getLogger("roster.runs")

RESTART_MESSAGE = "the API restarted while this run was in flight, so it was marked failed"


async def fail_interrupted_runs(uow_factory: Callable[[], AsyncUnitOfWork]) -> list[str]:
    """Mark every `running` run failed and record why. Returns the ids it touched.

    One transaction for the whole sweep: the terminal event and the terminal
    status become visible together, so an SSE reader that polls between them
    cannot see the status flip without also seeing the reason for it.
    """
    async with uow_factory().transaction() as tx:
        # order_by is spelled out: the repository default is "-created_at", and
        # runs has no such column (it carries started_at/finished_at instead).
        stranded = (
            await tx.runs.read_multi(
                filters={"status": "running"}, page_size=0, order_by="started_at"
            )
        ).results
        finished_at = datetime.now(UTC)
        for run in stranded:
            await tx.run_events.create(
                RunEvent(
                    id=new_id(),
                    run_id=run.id,
                    type="error",
                    message=RESTART_MESSAGE,
                    created_at=finished_at,
                )
            )
            await tx.runs.update(
                run.id, run.model_copy(update={"status": "failed", "finished_at": finished_at})
            )

    if stranded:
        logger.warning("marked %d interrupted run(s) failed on startup", len(stranded))
    return [run.id for run in stranded]
