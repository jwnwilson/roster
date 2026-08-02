from adapters.db.session import (
    prepare_database_url,
    session_factory,
    temporary_session_factory,
)
from config.settings import Settings, db_path


def test_the_url_names_rosters_database_with_its_async_driver(tmp_path):
    # Arrange
    settings = Settings(data_root=tmp_path)

    # Act
    url = prepare_database_url(settings)

    # Assert — how roster's database is addressed is the adapter's business; no
    # caller should have to spell the driver out.
    assert url == f"sqlite+aiosqlite:///{db_path(settings)}"


def test_preparing_the_url_creates_the_folder_the_database_lives_in(tmp_path):
    # Arrange — a first boot against a data root that does not exist yet.
    settings = Settings(data_root=tmp_path / "fresh")
    assert not (tmp_path / "fresh").exists()

    # Act
    prepare_database_url(settings)

    # Assert
    assert (tmp_path / "fresh").is_dir()


def test_one_session_factory_is_shared_per_database(tmp_path):
    # Arrange
    settings = Settings(data_root=tmp_path)

    # Act / Assert — a fresh engine per caller would mean a fresh connection pool
    # per caller, which is not what "one local SQLite file" means.
    assert session_factory(settings) is session_factory(settings)


async def test_a_temporary_factory_works_and_disposes_its_engine(tmp_path):
    # Arrange — a one-shot process (the seed CLI) gets an engine of its own so it
    # can hand it back rather than leaving the shared one open behind it.
    settings = Settings(data_root=tmp_path)

    # Act
    async with temporary_session_factory(settings) as factory:
        async with factory() as session:
            value = (await session.execute(_select_one())).scalar_one()

    # Assert
    assert value == 1
    assert session_factory(settings) is not factory


def _select_one():
    from sqlalchemy import select, text

    return select(text("1"))
