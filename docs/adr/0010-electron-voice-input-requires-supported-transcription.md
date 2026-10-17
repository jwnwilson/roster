# ADR 0010: Electron voice input requires a supported transcription path

## Status

Accepted — 2026-10-17.

## Context

Roster's voice button was refactored to call Chromium's `SpeechRecognition`
or `webkitSpeechRecognition` directly. Although the API can be present in an
Electron renderer, standard Electron builds do not ship the proprietary speech
recognition services used by Chrome and Edge. The result is an unavailable
feature or a `network` recognition error despite microphone permission being
granted.

The main-process media permission handler and macOS microphone usage
description are still necessary for microphone capture, but they cannot make
the browser recognition service available.

## Decision

Do not use the Web Speech `SpeechRecognition` API as Roster's supported voice
transcription path. Roster uses the explicit hosted OpenAI Audio
`gpt-4o-mini-transcribe` path: audio is recorded locally, sent only after
the person stops recording, and authenticated in the main process with the
opt-in `OPENAI_API_KEY` environment variable. The key never crosses the
preload bridge.

Keep the existing reviewed-draft behaviour: captured speech becomes editable
composer text and is never sent automatically.

## Consequences

* The current browser-recognition implementation is a known unsupported path
  and should be replaced, rather than debugged as a microphone-permission
  regression.
* Voice transcription requires a user-supplied OpenAI API key and incurs that
  provider's usage cost; unavailable or invalid credentials are reported in
  the composer without losing the draft.
* The implementation needs tests for capture, transcription failure, and
  insertion into the existing composer draft.
