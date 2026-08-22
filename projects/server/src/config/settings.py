from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="roster_", env_file=".env", extra="ignore")

    data_root: Path = Path("~/.roster")

    # Where the built UI lives, for the packaged desktop app. Blank in dev, where
    # Vite serves the UI on :5173 and proxies /api here. A setting because it is
    # the operator's answer to "which build of the UI", and the desktop shell is
    # the only thing that knows.
    ui_dir: Path | None = None

    # Where roster's database is, as a SQLAlchemy URL. A setting, because that is
    # what it is: the operator's answer to "which database", overridable as
    # `roster_db_url`.
    #
    # Blank is the normal case and means "the one under `data_root`". The default
    # is empty rather than a literal URL precisely because roster's database is
    # positioned relative to *another* setting — unlike a fixed connection string,
    # it cannot be written down here without also writing down the driver, and how
    # to spell a connection is `adapters/db/` business (see the guard in
    # tests/test_layering.py). So config states *that* there is a URL and lets the
    # adapter fill in the one it derives.
    db_url: str = ""

    # Agent execution. FakeRuntime stays the default so `make dev` and the whole
    # test suite are unchanged; setting this opts into spawning real CLIs.
    use_subprocess_runtime: bool = False
    agent_timeout_seconds: float = 900.0
    # Where each CLI lives, for operators whose binaries are not on PATH under
    # the obvious name. Overriding the *path* to a known tool is not the same as
    # letting agent content name an arbitrary command.
    tool_claude: str = "claude"
    tool_codex: str = "codex"
    # antigravity ships as `agy`, not as its own name — and not as `ayg`, which
    # is the transposition this defaulted to until the cask was read:
    # `Linking Binary 'antigravity' to '/opt/homebrew/bin/agy'`.
    tool_antigravity: str = "agy"

    memory_compact_entries: int = 10
    memory_compact_bytes: int = 32_768
    memory_digest_budget_bytes: int = 8_192
    memory_snapshot_keep: int = 20

    @field_validator("data_root")
    @classmethod
    def _expand(cls, value: Path) -> Path:
        return value.expanduser().resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()


def db_path(settings: Settings) -> Path:
    return settings.data_root / "roster.db"


def agents_dir(settings: Settings) -> Path:
    return settings.data_root / "agents"


# There is deliberately no `projects_dir` here. Where a managed project folder
# lives is a roster rule, and `domain.projects.resolve_folder` owns it — spelling
# it a second time in config/ made the same layout answerable from two layers.
