# Roster for macOS

An unsigned, arm64-only `.dmg`. Apple Silicon required.

## Install

1. Open the `.dmg` and drag **Roster** to Applications.
2. Remove the quarantine flag — the app is unsigned, so macOS blocks it otherwise:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Roster.app
   ```

3. Open Roster.

If step 2 is skipped, macOS reports the app as damaged or from an unidentified developer. Recent
macOS removed the old right-click → Open bypass for unsigned apps; System Settings → Privacy &
Security → **Open Anyway** is the fallback if you would rather not run the command.

## What it does with your machine

- Reads and writes `~/.roster` — the same data the development server uses.
- Spawns your installed agent CLIs (`claude`, `codex`, `ayg`) as subprocesses. It finds them by
  asking your login shell for its `PATH`; an agent whose CLI is not installed reports that on
  screen rather than failing silently.
- Logs the server to `~/Library/Logs/Roster/server.log`. **Send this file when reporting a
  problem.**

## Known limits

- No auto-update. Re-download to upgrade.
- Opening a `.dmg` older than your `~/.roster` schema refuses to start rather than migrating
  backwards. Use the newest build you have.
