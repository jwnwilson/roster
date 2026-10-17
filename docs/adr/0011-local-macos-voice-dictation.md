# ADR 0011: Voice dictation uses the local macOS Speech framework

## Status

Accepted — 2026-10-17.

## Context

The supported voice path in ADR 0010 uploaded a completed recording to OpenAI
Audio and required `OPENAI_API_KEY`. That contradicts the requirement for a
simple voice-to-text input without OpenAI. Chromium's `SpeechRecognition` is
not a replacement: standard packaged Electron does not provide its recognition
service reliably.

## Decision

Roster bundles a small Swift helper using Apple's Speech and AVFoundation
frameworks. It requires `supportsOnDeviceRecognition` and sets
`requiresOnDeviceRecognition`, so a recording is processed on the Mac and is
never uploaded by Roster. The helper owns microphone capture and returns only
the final text over a local stdio protocol; that text remains an editable
composer draft until the user sends it.

Version one is macOS-only. Windows and Linux report voice dictation as
unavailable, rather than silently falling back to OpenAI or a cloud service.

## Consequences

* No `OPENAI_API_KEY`, OpenAI Audio request, or renderer audio-upload IPC is
  needed for voice input.
* The app requests macOS Microphone and Speech Recognition permissions.
* Voice input depends on an installed on-device language model; unsupported
  languages fail with an actionable message.
* ADR 0010's OpenAI implementation decision is superseded; its Chromium
  compatibility finding remains applicable.
