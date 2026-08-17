#!/usr/bin/env bash
# Build the relocatable Python payload that ships inside Roster.app.
#
# Relocatable because the venv is built here and read from
# /Applications/Roster.app: any absolute path baked in at build time is a path
# that does not exist on the tester's machine. The assertions at the bottom are
# what stop that failing silently on someone else's Mac.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
build_dir="$repo_root/projects/desktop/build"
venv="$build_dir/python"

rm -rf "$build_dir"
mkdir -p "$build_dir/server"

uv venv --relocatable --python 3.12 "$venv"

# --no-dev: pytest, ruff and mypy have no business in a shipped app.
# --package roster-server, not a bare --no-dev export. roster-server lives only in the
# root pyproject's dev dependency-group, never in [project].dependencies, so a plain
# `--no-dev` export strips it and yields an EMPTY requirements file -- a venv that builds
# clean and then cannot import the app. Verified during Task 10.
uv export --frozen --no-dev --package roster-server --format requirements-txt \
  --project "$repo_root" > "$build_dir/requirements.txt"
test -s "$build_dir/requirements.txt" || { echo "FAIL: empty requirements export" >&2; exit 1; }
uv pip install --python "$venv/bin/python" -r "$build_dir/requirements.txt"
uv pip install --python "$venv/bin/python" --no-deps "$repo_root/projects/server"

# `uv venv --relocatable` does not reach every file it creates: bin/activate.csh
# still hardcodes VIRTUAL_ENV to this machine's absolute path (bin/activate,
# .fish, .ps1 etc. are already relative -- this is a csh-specific gap). The app
# invokes "$venv/bin/python" directly and never sources any activate script, so
# the file is dead weight; deleting it is the fix, not a workaround.
rm -f "$venv/bin/activate.csh"

# Installing a local source directory records its file:// path in PEP 610
# metadata (dist-info/direct_url.json) -- this machine's absolute path, baked
# in by uv/pip, not by anything this script asked for. Nothing at runtime reads
# it (Python's import machinery never touches direct_url.json), so removing it
# is safe and is what actually makes the venv relocatable rather than merely
# hiding the check.
find "$venv" -name direct_url.json -delete

# The shipped alembic.ini. The repo's own points at src/adapters/db/migrations,
# which does not exist in the bundle -- the migrations arrive inside
# site-packages instead, and shipping the source tree twice is waste.
python_version="$("$venv/bin/python" -c 'import sys; print(f"python{sys.version_info.major}.{sys.version_info.minor}")')"
cat > "$build_dir/server/alembic.ini" <<INI
[alembic]
script_location = %(here)s/../python/lib/$python_version/site-packages/adapters/db/migrations

[loggers]
keys = root

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console

[handler_console]
class = StreamHandler
args = (sys.stderr,)
formatter = generic

[formatter_generic]
format = %%(levelname)-5.5s [%%(name)s] %%(message)s
INI

# --- assertions: a bundle that fails these fails on a tester's Mac, not here ---

echo "checking the venv is relocatable…"
if grep -rIl --exclude=\*.pyc "$repo_root" "$venv" 2>/dev/null | head -1 | grep -q .; then
  echo "FAIL: the build path is baked into the venv:" >&2
  grep -rIl --exclude=\*.pyc "$repo_root" "$venv" | head -20 >&2
  exit 1
fi

echo "checking the server imports…"
"$venv/bin/python" -c "import interactors.api.app; interactors.api.app.create_app" >/dev/null

echo "checking alembic resolves its migrations…"
"$venv/bin/python" -m alembic -c "$build_dir/server/alembic.ini" heads >/dev/null

echo "python payload built at $venv"
