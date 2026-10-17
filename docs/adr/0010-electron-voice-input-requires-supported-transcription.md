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
transcription path. A replacement must explicitly provide its transcription
engine and lifecycle: either a local/offline engine bundled or installed with
Roster, or an opt-in hosted provider with its credentials, data handling, and
costs clearly presented to the user.

Keep the existing reviewed-draft behaviour: captured speech becomes editable
composer text and is never sent automatically.

## Consequences

* The current browser-recognition implementation is a known unsupported path
  and should be replaced, rather than debugged as a microphone-permission
  regression.
* The replacement needs tests for capture, cancellation, transcription failure,
  and insertion into the existing composer draft.
* Product must choose between local model distribution/compute cost and an
  opt-in hosted-transcription privacy/cost trade-off before implementation.
