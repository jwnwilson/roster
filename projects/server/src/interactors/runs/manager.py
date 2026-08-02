import asyncio
import logging
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from adapters.agents.runtime import AgentRuntime
from adapters.db.uow import AsyncUnitOfWork
from adapters.storage.local import LocalFileStore
from config.settings import Settings
from domain.agents import Agent
from domain.errors import RecordNotFound
from domain.ids import new_id
from domain.memory import MemoryStore, empty_digest, should_compact
from domain.projects import Project, memory_dir
from domain.runs import RunEvent, RunStatus
from domain.work_items import WorkItem

logger = logging.getLogger("roster.runs")

TIMESTAMP_FORMAT = "%Y-%m-%dT%H-%M-%SZ"


@dataclass(frozen=True)
class CompactionResult:
    """Outcome of one compaction attempt — carried explicitly so a caller never
    has to infer "did anything happen" from the digest text alone."""

    compacted: bool
    digest: str
    folded_entries: int
    error: str | None = None


class RunManager:
    """One asyncio task per run; owns the post-run memory step (spec §3, §5).

    A single instance must be shared across every run for a given project folder —
    the compaction lock below is keyed per-folder but scoped to *this instance*, so
    two RunManager objects racing to compact the same folder would defeat it entirely.

    Writes a run's events and status from a background asyncio task while an SSE
    request reads them independently — those are separate transactions. Each write
    below opens its own short-lived UnitOfWork and commits immediately, rather than
    holding one transaction open for the run's whole lifetime, so a concurrent
    reader's own transaction can see each event as soon as it lands.
    """

    def __init__(
        self,
        runtime: AgentRuntime,
        settings: Settings,
        uow_factory: Callable[[], AsyncUnitOfWork] | None,
    ) -> None:
        self._runtime = runtime
        self._settings = settings
        self._uow_factory = uow_factory
        self._compaction_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._in_flight: dict[str, asyncio.Task[None]] = {}

    def launch(
        self, run_id: str, agent: Agent, project: Project, work_item: WorkItem
    ) -> asyncio.Task[None]:
        """Start `run_id` in the background and keep the task reachable while it runs.

        The event loop holds only a *weak* reference to a running task, so a caller
        that discards `create_task`'s result can have its run garbage-collected
        part-way through with no error anywhere. Holding it here fixes that and
        makes in-flight runs enumerable, which a fire-and-forget task never is.
        """
        task = asyncio.create_task(self.start(run_id, agent, project, work_item))
        self._in_flight[run_id] = task
        # Discarded on completion (success, failure, or cancellation) so a
        # long-lived process doesn't accumulate finished tasks forever.
        task.add_done_callback(lambda _: self._in_flight.pop(run_id, None))
        return task

    def in_flight(self) -> list[str]:
        """The ids of the runs this manager is currently executing."""
        return sorted(self._in_flight)

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
            # Memory first, terminal status second, and the order is load-bearing.
            # The memory step can itself emit a RunEvent (a compaction failure),
            # and the SSE stream stops the moment it sees a terminal status — an
            # event written after that point is one the UI can never receive,
            # which spec §5 forbids ("recorded as a RunEvent *and* surfaced in the
            # UI — never swallowed"). _write_memory_safely swallows its own
            # exceptions, so this still cannot stop the run from finishing.
            await self._write_memory_safely(agent, project, run_id, status, summary_lines)
            await self._finish_run(run_id, status)

    async def _record_event(self, run_id: str, event_type: str, message: str) -> None:
        if self._uow_factory is None:
            return
        async with self._uow_factory().transaction() as tx:
            await tx.run_events.create(
                RunEvent(
                    id=new_id(),
                    run_id=run_id,
                    type=event_type,
                    message=message,
                    created_at=datetime.now(UTC),
                )
            )

    async def _finish_run(self, run_id: str, status: RunStatus) -> None:
        if self._uow_factory is None:
            return
        async with self._uow_factory().transaction() as tx:
            try:
                run = await tx.runs.read(run_id)
            except RecordNotFound:
                # The run row has vanished (e.g. the project/run was deleted
                # mid-flight) — must not take the whole asyncio task down with
                # an unhandled exception.
                return
            await tx.runs.update(
                run_id, run.model_copy(update={"status": status, "finished_at": datetime.now(UTC)})
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
        self, folder: Path, agent: Agent, run_id: str, timestamp: str, summary: str
    ) -> None:
        """Append this run's entry, then compact if the journal has grown enough.

        A run-triggered compaction failure is never fatal to the run: it's
        logged, best-effort recorded as a RunEvent, and swallowed here — the
        next finished run (or a manual /memory/compact call) retries it. This
        is deliberately different from compact_now()'s own caller-facing
        contract (see there) — a run must not fail because memory housekeeping
        did, but an explicit "compact now" request must not silently claim
        success when it didn't happen.
        """
        store = self._memory_store(folder)
        store.append_entry(run_id, timestamp, summary)

        entries = store.read_journal()
        total_bytes = sum(len(entry.text.encode()) for entry in entries)
        if not should_compact(
            len(entries),
            total_bytes,
            self._settings.memory_compact_entries,
            self._settings.memory_compact_bytes,
        ):
            return

        result = await self.compact_now(folder, agent)
        if result.error is not None:
            await self._record_compaction_failure(run_id, result.error)

    async def compact_now(self, folder: Path, agent: Agent) -> CompactionResult:
        """Fold whatever is currently in the journal into the digest. Never appends.

        Used both by write_memory (above, only once the threshold is crossed)
        and by the manual /memory/compact endpoint (unconditionally). All of
        the locking and race-safety lives here, in one place, so both callers
        share it exactly:
        """
        store = self._memory_store(folder)
        async with self._compaction_locks[str(folder)]:
            # Read inside the lock: another run may have compacted (or be
            # compacting) this same folder concurrently.
            entries = store.read_journal()
            if not entries:
                return CompactionResult(
                    compacted=False, digest=store.read_digest(), folded_entries=0
                )
            try:
                # A project that has never compacted has no digest yet. What that
                # blank digest should look like is roster's rule (spec §5), so it
                # is seeded here and handed over — the runtime is project-agnostic
                # infrastructure and never invents roster's shapes for itself.
                digest = await self._runtime.summarise(
                    agent,
                    store.read_digest() or empty_digest(folder.name),
                    [entry.text for entry in entries],
                    self._settings.memory_digest_budget_bytes,
                )
                store.compact(digest, [entry.path for entry in entries])
                return CompactionResult(
                    compacted=True, digest=digest, folded_entries=len(entries)
                )
            except Exception as error:
                # Journal and digest are untouched; the caller decides how to
                # treat this (non-fatal retry for a run, 503 for an explicit
                # API request) — compact_now itself never raises.
                logger.exception("compaction failed for %s", folder)
                return CompactionResult(
                    compacted=False,
                    digest=store.read_digest(),
                    folded_entries=0,
                    error=str(error),
                )

    async def _record_compaction_failure(self, run_id: str, message: str) -> None:
        if self._uow_factory is None:
            return
        try:
            async with self._uow_factory().transaction() as tx:
                await tx.run_events.create(
                    RunEvent(
                        id=new_id(),
                        run_id=run_id,
                        type="error",
                        message=f"memory compaction failed: {message}",
                        created_at=datetime.now(UTC),
                    )
                )
        except Exception:
            # Recording the failure is itself best-effort — never let *this* raise
            # and mask the original compaction failure.
            logger.exception("failed to record compaction-failure event for run %s", run_id)

    def _memory_store(self, folder: Path) -> MemoryStore:
        # Rooted at this project's own memory tree, not the wide app-level store — a
        # symlink planted inside snapshots/ must not be able to reach a sibling file
        # elsewhere in the project folder, let alone another project's memory. See
        # domain.memory.MemoryStore.restore for the allowlist half of this guarantee.
        file_store = LocalFileStore(memory_dir(folder))
        return MemoryStore(
            folder=folder, store=file_store, snapshot_keep=self._settings.memory_snapshot_keep
        )


def _build_summary(status: RunStatus, lines: list[str]) -> str:
    header = f"run finished with status: {status}"
    body = "\n".join(lines)
    return f"{header}\n\n{body}" if body else header
