.PHONY: install test coverage lint run db-upgrade dev e2e

install:
	uv sync
	cd projects/ui && pnpm install

test:
	uv run pytest

coverage:
	uv run pytest --cov --cov-report=term-missing --cov-fail-under=80

lint:
	uv run ruff check .
	uv run mypy projects/server/src

run:
	uv run uvicorn api.app:create_app --factory --reload --port 8000

db-upgrade:
	cd projects/server && uv run alembic upgrade head
