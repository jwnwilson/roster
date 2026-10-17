# ADR 0013: Diagnose desktop access through a Roster-owned macOS helper

Status: Accepted for diagnostics; desktop automation remains a separate feature.

## Context

Codex shell probes returned false for Accessibility, screen capture and input-posting access, zero visible screens, and no frontmost app. These observations describe that process's launch context; they do not establish what an installed Roster app can access. Repeating shell commands or relaxing agent sandbox settings would not establish the permissions of the shipping application.

## Decision

Bundle a small native macOS helper with Roster and expose a user-triggered Desktop diagnostics screen through the existing preload/IPC boundary. The helper reports its own permission state, screen count and frontmost application name. It accepts only a read-only probe or explicit Accessibility/Screen Recording permission requests. A diagnostic never captures screen content or sends input.

Use the same Swift source for development and packaged builds, compiling for the target architecture in afterPack before electron-builder signing. Development and packaged identities may receive different permissions; the installed signed application must be tested separately. Do not claim permission grants survive updates until verified on signed builds.

Bound helper execution to 30 seconds and 64 KiB output, validate JSON at the main-process boundary, and reject unsupported platforms and arbitrary commands. Report permission results individually rather than claiming that a successful preflight proves automation works.

Future agent desktop actions should go through Roster's authenticated MCP bridge with per-agent capabilities and one active desktop owner. This diagnostic does not add such tools or grant any agent desktop authority.

## Consequences and validation

Users can identify missing permissions from the application launch context and request them deliberately. macOS still requires the user's consent, and a denied permission may require a manual System Settings change and app restart. No permission database or sandbox policy is modified.

Unit tests cover response validation, platform restrictions and explicit permission arguments. Renderer tests cover no automatic inspection/prompting, permission requests and failures. Compile and run the native read-only probe locally; then validate the packaged app on a logged-in macOS desktop. Screen capture, click/type verification, signing identity persistence and serialized agent control remain subsequent work.
