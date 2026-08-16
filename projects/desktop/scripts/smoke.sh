#!/usr/bin/env bash
# Boot the built bundle's sidecar directly -- no Electron, no display -- and
# check it migrates, serves the API, and serves the UI.
#
# This is the half most likely to break and the half CI can actually run. What
# it does not cover is Electron's own window; spec §6.4 records that gap.
set -euo pipefail
# Job control, not `setsid`: setsid is a Linux (util-linux) command with no
# macOS build-in equivalent, and this smoke test only ever runs on macOS (the
# platform this app packages for). `set -m` gets the same result -- each
# backgrounded job becomes the leader of its own new process group -- so the
# `kill -TERM "-$server_pid"` in cleanup() below still reaps uvicorn and
# anything it forks, not just the pid bash happens to report for it.
set -m

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
build_dir="$repo_root/projects/desktop/build"
ui_dir="$repo_root/projects/ui/dist"
python="$build_dir/python/bin/python"
data_root="$(mktemp -d)"
port=8765

cleanup() {
  [[ -n "${server_pid:-}" ]] && kill -TERM "-$server_pid" 2>/dev/null || true
  rm -rf "$data_root"
}
trap cleanup EXIT

export roster_data_root="$data_root"
export roster_ui_dir="$ui_dir"

echo "migrating…"
(cd "$build_dir/server" && "$python" -m alembic -c "$build_dir/server/alembic.ini" upgrade head)

# Task 12: a plain `pnpm build` ships a UI with MSW mocking enabled by default
# (projects/ui/src/main.tsx starts the mock worker unless VITE_USE_MOCKS is
# exactly "false"). `make desktop` now passes that flag, but nothing checked
# that it took effect -- the packaged app would render fixtures forever and
# never touch ~/.roster, while looking perfectly healthy from the outside.
#
# The mock worker (src/mocks/browser.ts) is only reachable via a dynamic
# import, so Vite splits it into its own chunk when it is reachable at all;
# with the flag honored, dead-code elimination drops the import and the chunk
# never gets emitted. Grepping every shipped JS file for the setup call and
# the service-worker registration it pulls in -- not just index.html, since
# the entry chunk never references either string by name -- catches both the
# split-out chunk and any future bundling change that inlines them instead.
echo "checking the built UI does not ship mock-worker code…"
if grep -rl "setupWorker\|mockServiceWorker" "$ui_dir/assets" >/dev/null 2>&1; then
  echo "UI bundle references the mock service worker -- VITE_USE_MOCKS=false was not honored by the build" >&2
  exit 1
fi

echo "serving…"
(cd "$build_dir/server" && "$python" -m uvicorn interactors.api.desktop:create_desktop_app \
  --factory --host 127.0.0.1 --port "$port") &
server_pid=$!

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

echo "checking /api/health…"
curl -fsS "http://127.0.0.1:$port/api/health" | grep -q '"success":true'

echo "checking the UI is served…"
curl -fsS "http://127.0.0.1:$port/" | grep -qi "<title"

echo "checking an unknown /api path is JSON, not the app…"
curl -sS "http://127.0.0.1:$port/api/nope" | grep -q '"success":false'

echo "smoke passed"
