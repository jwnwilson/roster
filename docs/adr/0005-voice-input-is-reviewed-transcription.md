# ADR 0005: Voice input is reviewed transcription

## Status

Accepted — 2026-09-11. Amended the same day to remove the hosted
transcription dependency.

## Context

Roster's agent conversations are text turns sent to provider CLIs. A person
needs to be able to speak a request instead of typing one, without making an
audio recording part of an agent transcript or changing the session protocol.

The renderer is the only process that may access a microphone. Roster's user
wants speech placed in the Chat composer, not a separate paid transcription
service or another credential to configure.

## Decision

The first voice release is speech-to-text in the agent Chat composer only.
Recording is an explicit start/stop action. Once stopped, Roster transcribes
the completed clip and inserts the result into the composer for review. It
never sends automatically; the existing Send action remains the only action
that starts an agent turn.

The renderer uses Chromium's `SpeechRecognition` capability directly, with
the prefixed `webkitSpeechRecognition` form as a compatibility fallback. No
audio leaves Roster through an application-controlled service and no API key
is required. The result event inserts the final recognised text into the
composer. If recognition is unavailable, denied, or cannot hear speech, the
composer stays intact and explains the problem.

This decision excludes spoken agent replies, live partial transcription,
task-comment recording, and a persistent in-app API-key settings surface.

## Consequences

* Voice input works with the same prompt review and session-send safeguards as
  typed chat, including plan mode.
* The OS microphone prompt is explicit, and failed recording or transcription
  leaves the typed draft untouched.
* Voice input requires an Electron/Chromium build whose speech-recognition
  capability is available. Typed chat remains fully available when it is not.
* Recognition may rely on the platform/browser service and its network policy;
  a future offline implementation would bundle and manage a local model as a
  separate product decision.
