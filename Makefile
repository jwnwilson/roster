.PHONY: install install-server install-ui test coverage lint dev dev-server dev-ui run seed db-upgrade

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
# Both halves, per spec §1. The API serves :8000 and the UI :5173.
#
# `trap 'kill 0'` is what makes Ctrl-C stop both. Without it, Vite is orphaned
# holding :5173 and the next `make dev` fails on a port already in use with
# nothing obvious to blame.
#
# `kill 0` signals the whole process group rather than two recorded PIDs, which
# matters because neither child is the process actually holding the port: make
# spawns a shell, which spawns `uv run`, which spawns uvicorn. Killing the PIDs
# we can see leaves the grandchildren running — verified by watching exactly
# that happen with a PID-based trap.
dev: db-upgrade seed
	@if [ ! -d projects/ui ]; then \
		echo "projects/ui is not present — starting the API only"; \
		$(MAKE) run; \
	else \
		trap 'kill 0' INT TERM EXIT; \
		$(MAKE) dev-server & \
		$(MAKE) dev-ui & \
		wait; \
	fi

dev-server: run

# Installing first, because the failure otherwise is `vite: command not found`
# from inside a backgrounded sub-make — which reads as a broken toolchain rather
# than "this checkout has no node_modules yet". A fresh worktree hits it every
# time. pnpm exits quickly when everything is already present.
dev-ui:
	cd projects/ui && pnpm install --prefer-offline && pnpm dev

run:
	uv run uvicorn interactors.api.app:create_app --factory --reload --port 8000

seed:
	uv run python -m interactors.cli.seed

db-upgrade:
	cd projects/server && uv run alembic upgrade head
