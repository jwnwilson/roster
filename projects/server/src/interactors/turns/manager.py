import asyncio
import logging
from collections import defaultdict
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from adapters.agents.runtime import AgentRuntime
from adapters.db.uow import AsyncUnitOfWork
from config.settings import Settings
from domain.agents import Agent
from domain.errors import RecordNotFound
from domain.ids import new_id
from domain.memory import MemoryStore, empty_digest, should_compact
from domain.threads import Message, MessageKind, Thread, status_after_message
from interactors.memory_stores import open_project_memory

logger = logging.getLogger("roster.turns")


@dataclass(frozen=True)
class CompactionResult:
    """Outcome of one compaction attempt — carried explicitly so a caller never
    has to infer "did anything happen" from the digest text alone."""

    compacted: bool
    digest: str
    folded_entries: int
    error: str | None = None


class AgentTurnManager:
    """One asyncio task per in-flight agent turn; owns the memory step (spec §3, §5).

    A single instance must be shared across every turn for a given project folder —
    the compaction lock below is keyed per-folder but scoped to *this instance*, so
    two managers racing to compact the same folder would defeat it entirely.

    Writes a turn's messages from a background asyncio task while an SSE request
    reads them independently — those are separate transactions. Each write below
    opens its own short-lived UnitOfWork and commits immediately, rather than
    holding one transaction open for the turn's whole lifetime, so a concurrent
    reader's own transaction can see each message as soon as it lands.

    Note what this class does *not* do, unlike the run manager it replaces: a turn
    has no persisted status to finalise, and it does not write memory. Memory hangs
    off a thread being *resolved* (spec §5), which is an operator action that may
    come many turns later — so `write_memory` and `compact_now` live here but are
    called from the resolution path, not from `start`.
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
        self._in_flight: dict[tuple[str, str], asyncio.Task[None]] = {}

    def launch(self, thread: Thread, agent: Agent, project_folder: str) -> asyncio.Task[None]:
        """Start a turn in the background and keep the task reachable while it runs.

        The event loop holds only a *weak* reference to a running task, so a caller
        that discards `create_task`'s result can have its turn garbage-collected
        part-way through with no error anywhere. Holding it here fixes that and
        makes in-flight turns enumerable, which a fire-and-forget task never is —
        and enumerable is what gives `busy_agents` an answer.
        """
        key = (thread.id, agent.name)
        task = asyncio.create_task(self.start(thread, agent, project_folder))
        self._in_flight[key] = task
        # Discarded on completion (success, failure, or cancellation) so a
        # long-lived process doesn't accumulate finished tasks forever.
        task.add_done_callback(lambda _: self._in_flight.pop(key, None))
        return task

    async def drain(self) -> None:
        """Wait for every in-flight turn to finish.

        A turn outlives the request that started it by design, which is fine in
        production and a hazard in a test: the event loop and connection pool are
        torn down while a background task is still writing, and the failure is
        timing-dependent — it passed locally and failed on CI. Anything that ends
        the process (or a test) while turns are in flight should await this first.
        """
        tasks = list(self._in_flight.values())
        for task in tasks:
            with suppress(Exception):
                await task

    def busy_agents(self) -> list[str]:
        """The agents currently taking a turn.

        Spec §3: this is the only source of `Working` status. It is process memory
        rather than a column precisely because a turn is not persisted — an agent
        cannot be left marked Working by a crash, because nothing recorded it.
        """
        return sorted({agent_name for _thread_id, agent_name in self._in_flight})

    async def start(self, thread: Thread, agent: Agent, project_folder: str) -> None:
        """Stream the runtime's output into the thread as messages.

        A crash is recorded as an `event` message rather than swallowed (spec §7):
        the thread stays open, so the operator can see what happened and retry by
        posting again.
        """
        status = thread.status
        try:
            async for kind, content in self._runtime.execute(agent, project_folder, thread.title):
                await self._record_message(thread.id, kind, content, agent.name)
                status = status_after_message(status, _as_kind(kind))
        except Exception as error:
            await self._record_message(thread.id, "event", f"turn failed: {error}", agent.name)
            logger.exception("turn on thread %s crashed", thread.id)
        finally:
            if status != thread.status:
                await self._move_thread(thread.id, status)

    async def _record_message(
        self, thread_id: str, kind: str, content: str, agent_name: str
    ) -> None:
        if self._uow_factory is None:
            return
        async with self._uow_factory().transaction() as tx:
            await tx.messages.create(
                Message(
                    id=new_id(),
                    thread_id=thread_id,
                    author_kind="agent",
                    author_name=agent_name,
                    kind=_as_kind(kind),
                    content=content,
                    created_at=datetime.now(UTC),
                )
            )

    async def _move_thread(self, thread_id: str, status: str) -> None:
        if self._uow_factory is None:
            return
        async with self._uow_factory().transaction() as tx:
            try:
                thread = await tx.threads.read(thread_id)
            except RecordNotFound:
                # The thread has vanished (its project was deleted mid-turn) — must
                # not take the whole asyncio task down with an unhandled exception.
                return
            await tx.threads.update(thread_id, thread.model_copy(update={"status": status}))

    async def write_memory(
        self, folder: Path, agent: Agent, thread_id: str, timestamp: str, summary: str
    ) -> None:
        """Append this thread's entry, then compact if the journal has grown enough.

        A resolution-triggered compaction failure is never fatal: it's logged,
        best-effort recorded as a message on the thread, and swallowed here — the
        next resolved thread (or a manual /memory/compact call) retries it. This is
        deliberately different from compact_now()'s own caller-facing contract (see
        there) — resolving a thread must not fail because memory housekeeping did,
        but an explicit "compact now" request must not silently claim success when
        it didn't happen.
        """
        store = self._memory_store(folder)
        store.append_entry(thread_id, timestamp, summary)

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
            await self._record_compaction_failure(thread_id, result.error)

    async def compact_now(self, folder: Path, agent: Agent) -> CompactionResult:
        """Fold whatever is currently in the journal into the digest. Never appends.

        Used both by write_memory (above, only once the threshold is crossed) and
        by the manual /memory/compact endpoint (unconditionally). All of the
        locking and race-safety lives here, in one place, so both callers share it
        exactly.
        """
        store = self._memory_store(folder)
        async with self._compaction_locks[str(folder)]:
            # Read inside the lock: another thread may have compacted (or be
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
                # Journal and digest are untouched; the caller decides how to treat
                # this (non-fatal retry on resolution, 503 for an explicit API
                # request) — compact_now itself never raises.
                logger.exception("compaction failed for %s", folder)
                return CompactionResult(
                    compacted=False,
                    digest=store.read_digest(),
                    folded_entries=0,
                    error=str(error),
                )

    async def _record_compaction_failure(self, thread_id: str, message: str) -> None:
        if self._uow_factory is None:
            return
        try:
            await self._record_message(
                thread_id, "event", f"memory compaction failed: {message}", "system"
            )
        except Exception:
            # Recording the failure is itself best-effort — never let *this* raise
            # and mask the original compaction failure.
            logger.exception("failed to record compaction failure on thread %s", thread_id)

    def _memory_store(self, folder: Path) -> MemoryStore:
        return open_project_memory(folder, self._settings.memory_snapshot_keep)


_KINDS: frozenset[str] = frozenset({"text", "file_write", "question", "event"})


def _as_kind(kind: str) -> MessageKind:
    """A runtime is project-agnostic and yields a plain string; anything roster does
    not recognise is recorded as an `event` rather than rejected, so a future or
    third-party runtime can never crash a turn by naming a kind we have not met."""
    return kind if kind in _KINDS else "event"  # type: ignore[return-value]


def build_summary(thread: Thread, messages: list[Message]) -> str:
    """The journal entry written when a thread resolves (spec §5)."""
    header = f"thread resolved: {thread.title}"
    body = "\n".join(f"{message.author_name or 'operator'}: {message.content}"
                     for message in messages)
    return f"{header}\n\n{body}" if body else header
