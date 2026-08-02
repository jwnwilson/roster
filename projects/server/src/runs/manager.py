import asyncio
import logging
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from adapters.agents.runtime import AgentRuntime
from adapters.db import runs as runs_db
from adapters.memory.store import MemoryStore
from config.settings import Settings
from domain.agents import Agent
from domain.ids import new_id
from domain.memory import should_compact
from domain.projects import Project
from domain.runs import RunEvent, RunStatus
from domain.work_items import WorkItem

logger = logging.getLogger("roster.runs")

TIMESTAMP_FORMAT = "%Y-%m-%dT%H-%M-%SZ"


class RunManager:
    """One asyncio task per run; owns the post-run memory step (spec §3, §5).

    A single instance must be shared across every run for a given project folder —
    the compaction lock below is keyed per-folder but scoped to *this instance*, so
    two RunManager objects racing to compact the same folder would defeat it entirely.
    """

    def __init__(
        self,
        runtime: AgentRuntime,
        settings: Settings,
        session_factory: async_sessionmaker[AsyncSession] | None,
    ) -> None:
        self._runtime = runtime
        self._settings = settings
        self._session_factory = session_factory
        self._compaction_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def start(self, run_id: str, agent: Agent, project: Project, work_item: WorkItem) -> None:
        """Stream the runtime's events into RunEventRows, then always write memory.

        The memory step runs in `finally` so it fires on both the success and the
        failure path — including a runtime that raises mid-stream — per spec §5:
        a run that failed on an environment quirk is often the most valuable thing
        to remember.
        """
        status: RunStatus = "complete"
        summary_lines: list[str] = []
        try:
            async for event_type, message in self._runtime.execute(
                agent, project.folder_path, work_item.title
            ):
                summary_lines.append(f"{event_type}: {message}")
                await self._record_event(run_id, event_type, message)
                if event_type == "error":
                    status = "failed"
        except Exception as error:
            status = "failed"
            summary_lines.append(f"error: {error}")
            await self._record_event(run_id, "error", str(error))
            logger.exception("run %s crashed", run_id)
        finally:
            await self._finish_run(run_id, status)
            await self._write_memory_safely(agent, project, run_id, status, summary_lines)

    async def _record_event(self, run_id: str, event_type: str, message: str) -> None:
        if self._session_factory is None:
            return
        async with self._session_factory() as session:
            await runs_db.insert_event(
                session,
                RunEvent(
                    id=new_id(),
                    run_id=run_id,
                    type=event_type,
                    message=message,
                    created_at=datetime.now(UTC),
                ),
            )

    async def _finish_run(self, run_id: str, status: RunStatus) -> None:
        if self._session_factory is None:
            return
        async with self._session_factory() as session:
            await runs_db.update_run_status(
                session, run_id, status, finished_at=datetime.now(UTC)
            )

    async def _write_memory_safely(
        self, agent: Agent, project: Project, run_id: str, status: RunStatus, lines: list[str]
    ) -> None:
        summary = _build_summary(status, lines)
        timestamp = datetime.now(UTC).strftime(TIMESTAMP_FORMAT)
        try:
            await self.write_memory(
                folder=Path(project.folder_path),
                agent=agent,
                run_id=run_id,
                timestamp=timestamp,
                summary=summary,
            )
        except Exception:
            # The post-run memory write must never crash the run itself (spec §5
            # Safety) — append_entry can still raise on a genuine disk error, and
            # this is the last line of defence against that taking the run task
            # down with it after the run's own status has already been recorded.
            logger.exception("post-run memory write failed for run %s", run_id)

    async def write_memory(
        self,
        folder: Path,
        agent: Agent,
        run_id: str,
        timestamp: str,
        summary: str,
        force: bool = False,
    ) -> None:
        """Append this run's entry, then compact if the journal has grown enough.

        `force` skips the should_compact() threshold check and always attempts
        a compaction — used by the manual "compact now" endpoint, which has no
        threshold of its own to honour. It still goes through the same lock and
        the same failure handling as every other compaction.
        """
        store = MemoryStore(folder=folder, settings=self._settings)
        store.append_entry(run_id, timestamp, summary)

        entries = store.read_journal()
        total_bytes = sum(len(entry.text.encode()) for entry in entries)
        if not force and not should_compact(
            len(entries),
            total_bytes,
            self._settings.memory_compact_entries,
            self._settings.memory_compact_bytes,
        ):
            return

        async with self._compaction_locks[str(folder)]:
            # Re-read inside the lock: another run may have compacted while we waited.
            entries = store.read_journal()
            if not entries:
                return
            try:
                digest = await self._runtime.summarise(
                    agent,
                    store.read_digest(),
                    [entry.text for entry in entries],
                    self._settings.memory_digest_budget_bytes,
                )
                store.compact(digest, [entry.path for entry in entries])
            except Exception as error:
                # Journal and digest are untouched; the next finished run retries.
                logger.exception("compaction failed for %s", folder)
                await self._record_compaction_failure(run_id, error)

    async def _record_compaction_failure(self, run_id: str, error: Exception) -> None:
        if self._session_factory is None:
            return
        try:
            async with self._session_factory() as session:
                await runs_db.insert_event(
                    session,
                    RunEvent(
                        id=new_id(),
                        run_id=run_id,
                        type="error",
                        message=f"memory compaction failed: {error}",
                        created_at=datetime.now(UTC),
                    ),
                )
        except Exception:
            # Recording the failure is itself best-effort — never let *this* raise
            # and mask the original compaction failure.
            logger.exception("failed to record compaction-failure event for run %s", run_id)


def _build_summary(status: RunStatus, lines: list[str]) -> str:
    header = f"run finished with status: {status}"
    body = "\n".join(lines)
    return f"{header}\n\n{body}" if body else header
