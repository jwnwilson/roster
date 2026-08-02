.PHONY: install install-server install-ui test coverage lint run seed db-upgrade

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

run:
	uv run uvicorn interactors.api.app:create_app --factory --reload --port 8000

seed:
	uv run python -m interactors.cli.seed

db-upgrade:
	cd projects/server && uv run alembic upgrade head
