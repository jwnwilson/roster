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
