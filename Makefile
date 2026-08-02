.PHONY: install install-server install-ui test coverage lint dev run seed db-upgrade

# The UI half is skipped when projects/ui is absent, so a clean checkout of a
# server-only branch still installs — it is the first command AGENTS.md tells a
# newcomer to run. `make install-ui` on its own is the deliberate way to demand
# the UI and get a real failure if it is missing.
install: install-server
	@if [ -d projects/ui ]; then \
		$(MAKE) install-ui; \
	else \
		echo "projects/ui is not present on this branch — skipping the UI install"; \
	fi

install-server:
	uv sync

install-ui:
	cd projects/ui && pnpm install

test:
	uv run pytest

coverage:
	uv run pytest --cov --cov-report=term-missing --cov-fail-under=80

lint:
	uv run ruff check .
	uv run mypy projects/server/src

# Spec §1: the API boots "migrated and seeded". The three steps are ordered and
# each is a hard gate — seeding an unmigrated database fails on a missing table,
# and serving an unseeded one gives you an empty board with nothing to look at.
# `seed` is a no-op on a data root that already has projects, so this is safe to
# run on every boot, which is the point of it being one target.
#
# The backend half only. Spec §1 reads "…and the UI"; that half arrives with the
# UI work (its Task 14) and extends this target rather than replacing it.
dev: db-upgrade seed run

run:
	uv run uvicorn interactors.api.app:create_app --factory --reload --port 8000

seed:
	uv run python -m interactors.cli.seed

db-upgrade:
	cd projects/server && uv run alembic upgrade head
