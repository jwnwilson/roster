from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="roster_", env_file=".env", extra="ignore")

    data_root: Path = Path("~/.roster")
    agent_runtime: str = "fake"

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
