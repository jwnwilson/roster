import asyncio
from logging.config import fileConfig
from typing import Any

from alembic import context
from sqlalchemy import event, pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from adapters.db import orm  # noqa: F401  — import registers the tables on Base.metadata
from adapters.db.engine import Base
from adapters.db.session import prepare_database_url
from config.settings import get_settings

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _url() -> str:
    # The URL comes from the same place the app's does — only the *engine* below
    # is this environment's own (see the comment there).
    return prepare_database_url(get_settings())


# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def _disable_foreign_keys(dbapi_connection: Any, _record: Any) -> None:
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=OFF")
    finally:
        cursor.close()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """In this scenario we need to create an Engine
    and associate a connection with the context.

    """

    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = _url()
    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    # Deliberately *not* `adapters.db.engine.make_engine`: that one turns
    # `foreign_keys` ON, and SQLite cannot ALTER a foreign key, so migration 0003
    # recreates each child table (create tmp → copy → drop original → rename).
    # With enforcement on, the drop step is refused the moment any child row
    # exists. Enforcement is a runtime property of the app's own engine; a
    # migration is the one place that has to move the constraints themselves.
    # The pragma has to be set on `connect`, before anything opens a transaction —
    # inside one it is silently a no-op.
    event.listen(connectable.sync_engine, "connect", _disable_foreign_keys)

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
