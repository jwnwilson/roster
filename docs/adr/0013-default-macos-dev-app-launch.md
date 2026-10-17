# ADR 0013: Default macOS development to the application launch

## Status

Accepted — 2026-10-17; voice runtime acceptance remains outstanding.

## Context

PR #121 introduced `dev:app` but preserved the failing `npm run dev` path.
After that change, the user still reported failure. The 20:58:03 and 20:58:29
voice crash reports again identify Electron as parent, Code as responsible
process, and a TCC termination for missing Speech usage metadata. The helper
and development Electron already contain that metadata (ADR 0012).

## Decision

Route `npm run dev` and `npm run dev:debug` on macOS through the existing
application-bundle launch commands. Preserve direct electron-vite development
under `dev:hot` and `dev:hot:debug`, and keep it as the default on other platforms.
Run preparation once in the concrete launch path. Inherit the invoking npm,
working directory and environment, and propagate launch-command failures.
Set `ROSTER_UPDATE_CHECK=0` on local app launches unless the developer explicitly
sets it to 1, preserving suppression of automatic release offers in development.

## Consequences

The established macOS command now selects the intended permission-identity
boundary. It builds and packages before launch and requires quitting/relaunching
after edits; it does not hot reload. Startup output and README make that tradeoff
explicit. No third-party application metadata or privacy grants are modified.
Launch Services owns the launched process: Ctrl-C does not guarantee termination
of Roster. Require Cmd-Q before relaunching; do not equate the status of `open`
with the app's exit status.

This corrects command selection; it does not prove that Launch Services,
permission consent, microphone capture and transcription succeed on the user's
machine. Acceptance requires a normal GUI session running the changed command,
permission prompts identifying Roster, and dictated text reaching the composer.
