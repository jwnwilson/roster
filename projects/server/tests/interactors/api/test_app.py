"""The app factory's wiring: where the session factory comes from and who owns it.

`httpx.ASGITransport` never dispatches lifespan events, so the startup/shutdown
tests here drive `app.router.lifespan_context` directly rather than through a
client — otherwise this half of `create_app` would look covered while never
running (the same trap `lifespan`'s own docstring warns about).
"""

from sqlalchemy import text

from adapters.db.uow import AsyncUnitOfWork
from domain.ids import new_id
from domain.projects import Project, ProjectSource
from domain.runs import Run
from domain.work_items import WorkItem
from interactors.api.app import create_app


async def test_create_app_puts_the_session_factory_it_was_given_on_app_state(session_factory):
    # Act
    app = create_app(session_factory=session_factory)

    # Assert — one source of truth for how to reach the database: anything that
    # needs a session (a request's UnitOfWork, RunManager's background writes,
    # the SSE stream) reads it from here rather than building its own.
    assert app.state.session_factory is session_factory


async def test_create_app_builds_a_session_factory_from_settings_when_given_none(
    monkeypatch, tmp_path
):
    # Arrange — no factory supplied, so `create_app` must fall back to the
    # configured data root. This is the `make run` / `--factory` path.
    monkeypatch.setenv("roster_data_root", str(tmp_path))

    # Act
    app = create_app()
    async with app.state.session_factory() as session:
        await session.execute(text("select 1"))

    # Assert — the database it opened is the one settings named, not a default
    # buried in the app factory.
    assert (tmp_path / "roster.db").exists()


async def test_an_engine_create_app_built_itself_is_disposed_on_shutdown(monkeypatch, tmp_path):
    # Arrange
    monkeypatch.setenv("roster_data_root", str(tmp_path))
    app = create_app()
    # The engine is reachable only through the sessionmaker's bind; `create_app`
    # deliberately doesn't publish it, because nothing but shutdown needs it.
    engine = app.state.session_factory.kw["bind"]
    pool_before = engine.pool

    # Act
    async with app.router.lifespan_context(app):
        pass

    # Assert — `dispose()` swaps in a fresh pool, so an unchanged pool identity
    # would mean the connections were left open behind the exiting process.
    assert engine.pool is not pool_before


async def test_an_injected_session_factory_is_not_disposed_on_shutdown(session_factory):
    # Arrange — the engine belongs to whoever passed the factory in (a test, or a
    # future embedder). Disposing it would pull it out from under them.
    app = create_app(session_factory=session_factory)
    engine = session_factory.kw["bind"]
    pool_before = engine.pool

    # Act
    async with app.router.lifespan_context(app):
        pass

    # Assert
    assert engine.pool is pool_before


async def test_startup_reconciliation_runs_against_the_factory_on_app_state(
    session_factory, uow
):
    # Arrange — a run the "previous process" left in flight, in the database the
    # app was handed. If startup reconciliation built its own factory instead,
    # this run would still be `running` afterwards.
    project_id, item_id = new_id(), new_id()
    async with uow.transaction() as tx:
        await tx.projects.create(
            Project(
                id=project_id,
                name="P",
                source=ProjectSource(kind="none"),
                folder_path="/tmp/p",
            )
        )
        await tx.work_items.create(
            WorkItem(
                id=item_id, key="ROS-1", project_id=project_id, type="task",
                title="Do it", sequence=1,
            )
        )
        await tx.runs.create(
            Run(
                id="stranded", project_id=project_id, work_item_id=item_id,
                agent_name="atlas", status="running",
            )
        )
    app = create_app(session_factory=session_factory)

    # Act
    async with app.router.lifespan_context(app):
        pass

    # Assert
    async with AsyncUnitOfWork(session_factory).transaction() as tx:
        assert (await tx.runs.read("stranded")).status == "failed"
