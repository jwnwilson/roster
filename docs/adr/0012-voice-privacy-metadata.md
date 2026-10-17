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

On 2026-10-17, the 20:36:54 helper crash still reported a TCC termination for
missing `NSSpeechRecognitionUsageDescription`. Its UUID matched the current
helper, which contained both embedded descriptions. The development Electron
bundle also contained the Speech description. The crash identified Electron as
the parent but **Code** as the responsible process (`com.microsoft.VSCode`);
the installed VS Code bundle lacked the Speech description.

This rules out a stale helper for that incident and makes responsible-app
attribution the next hypothesis to verify. Embedded helper metadata alone is
not sufficient evidence that the actual permission request will succeed.

Keep the metadata added above, but validate permissions through the actual
launch path. Compare development launched from VS Code with a current Roster
app launched through Finder/Launch Services. Record the app version, permission
prompt identity, helper outcome, and whether spoken text reaches the composer.
Do not patch a third-party editor's bundle or reset users' privacy grants to
make this comparison pass. Any change to the development launcher requires
its own runtime verification before it is treated as a fix.

The installed `/Applications/Roster.app` inspected during this investigation
was version 0.1.57 and lacked the Speech description, so that installation
cannot validate the newer metadata repair. The sandbox also rejected the
Launch Services comparison; successful microphone transcription remains
unverified and ROS-17 remains in progress.
