from adapters.db.session import prepare_database_url, temporary_session_factory
from config.settings import Settings, db_path


def test_the_url_names_rosters_database_with_its_async_driver(tmp_path):
    # Arrange
    settings = Settings(data_root=tmp_path)

    # Act
    url = prepare_database_url(settings)

    # Assert — how roster's database is addressed is the adapter's business; no
    # caller should have to spell the driver out.
    assert url == f"sqlite+aiosqlite:///{db_path(settings)}"


def test_an_operator_supplied_db_url_is_used_verbatim(tmp_path):
    # Arrange — `db_url` is a settings value first (the reference's shape); the
    # derivation below is only what fills it in when the operator said nothing.
    settings = Settings(data_root=tmp_path, db_url="sqlite+aiosqlite:///:memory:")

    # Act / Assert
    assert prepare_database_url(settings) == "sqlite+aiosqlite:///:memory:"


def test_the_db_url_setting_is_read_from_the_environment(monkeypatch, tmp_path):
    # Arrange
    monkeypatch.setenv("ROSTER_DATA_ROOT", str(tmp_path))
    monkeypatch.setenv("ROSTER_DB_URL", "sqlite+aiosqlite:///:memory:")

    # Act / Assert — settings are the only way configuration reaches roster
    # (AGENTS.md), so an operator pointing the database elsewhere does it here.
    assert Settings().db_url == "sqlite+aiosqlite:///:memory:"


def test_an_operator_supplied_url_does_not_create_the_data_root_folder(tmp_path):
    # Arrange — the mkdir exists because *roster* chose a path SQLite will not
    # create for itself. When the operator names the URL, roster did not choose
    # the path and has no business guessing which folder to make.
    settings = Settings(data_root=tmp_path / "fresh", db_url="sqlite+aiosqlite:///:memory:")

    # Act
    prepare_database_url(settings)

    # Assert
    assert not (tmp_path / "fresh").exists()


def test_preparing_the_url_creates_the_folder_the_database_lives_in(tmp_path):
    # Arrange — a first boot against a data root that does not exist yet.
    settings = Settings(data_root=tmp_path / "fresh")
    assert not (tmp_path / "fresh").exists()

    # Act
    prepare_database_url(settings)

    # Assert
    assert (tmp_path / "fresh").is_dir()


async def test_a_temporary_factory_works_and_disposes_its_engine(tmp_path):
    # Arrange — a one-shot process (the seed CLI) gets an engine of its own so it
    # can hand it back rather than exiting behind one nothing will ever close.
    settings = Settings(data_root=tmp_path)

    # Act
    async with temporary_session_factory(settings) as factory:
        async with factory() as session:
            value = (await session.execute(_select_one())).scalar_one()
        engine = factory.kw["bind"]
        pool_while_open = engine.pool

    # Assert — the second half of this test's name was never actually checked:
    # it used to assert only that the factory differed from the process-wide
    # cached one, which no longer exists. Disposal is what the name claims, so
    # that is what is asserted now — `dispose()` swaps in a fresh pool, and an
    # unchanged pool identity would mean the connections outlived the CLI.
    assert value == 1
    assert engine.pool is not pool_while_open


def _select_one():
    from sqlalchemy import select, text

    return select(text("1"))
