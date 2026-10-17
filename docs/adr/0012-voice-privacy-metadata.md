# ADR 0012: Voice permission descriptions accompany the native executable

## Status

Accepted — 2026-10-17.

## Context

The macOS crash report for roster-voice at 18:56:26 shows a TCC privacy
termination because NSSpeechRecognitionUsageDescription was absent. The
run-loop repair was already present. The descriptions in electron-builder's
extendInfo did not reach the development Electron bundle or standalone helper.

## Decision

Embed build/voice/Info.plist in the helper's Mach-O __TEXT,__info_plist section
in both development and packaged compilation. Include Speech Recognition and
Microphone descriptions. Populate those same permission keys on the local
development Electron bundle after ensuring Electron is installed. Run this
preparation for both dev and dev:debug.

## Consequences

The executable requesting access carries its privacy explanations, and the
development host also has them. Preparation changes only the worktree's
installed Electron, not the system's privacy permissions. Users still decide
whether to grant access. Generated helper binaries are ignored by git.

Compilation and metadata inspection are necessary checks, but do not prove
successful speech recognition; real permission and microphone testing remains
required. The on-device-only policy in ADR 0011 is unchanged.

## Follow-up: responsible application identity

The 20:36:54 helper crash on 2026-10-17 matched the current helper UUID and
that helper contained both embedded descriptions. The development Electron
bundle also contained the Speech description, but the crash named **Code**
(`com.microsoft.VSCode`) as the responsible process. This rules out stale
helper metadata for that incident; do not modify VS Code or TCC grants.

## Follow-up: development launch boundary

`electron-vite dev` starts Electron with `child_process.spawn`, making its
editor ancestry the responsible process for a helper it launches. The supported
macOS boundary for a separately attributed GUI application is a Launch Services
application-bundle launch (`open`/`NSWorkspace`), not a private responsibility
API.

Provide `npm run dev:app` as the explicit voice-permission development path. It
builds the current worktree into `release/<architecture>/Roster.app`, then uses
`open -n -W` with the absolute bundle path. It forwards `ROSTER_HOME` and
`PATH`, keeps terminal output and exit status attached, and accepts Electron
debug arguments through `dev:app:debug`. The packaged helper is resolved from
the app resources, so Launch Services' working directory does not affect it.

Do not replace `npm run dev`: electron-vite owns its spawned child and restart
lifecycle. Interposing an asynchronous Launch Services launch there would make
main-process reloads and shutdown unreliable. The explicit path deliberately
requires a rebuild and relaunch after source changes. It must still be accepted
by a real Speech permission prompt and speech-to-composer transcription before
the TCC failure is considered resolved.
