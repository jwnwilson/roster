# ADR 0005: Voice input is reviewed transcription

## Status

Accepted — 2026-09-11.

## Context

Roster's agent conversations are text turns sent to provider CLIs. A person
needs to be able to speak a request instead of typing one, without making an
audio recording part of an agent transcript or changing the session protocol.

The renderer is the only process that may access a microphone. It must not
also receive a provider credential. Roster has no general encrypted settings
screen yet; its MCP configuration is deliberately unsuitable because it is
plain text and visible to the renderer.

## Decision

The first voice release is speech-to-text in the agent Chat composer only.
Recording is an explicit start/stop action. Once stopped, Roster transcribes
the completed clip and inserts the result into the composer for review. It
never sends automatically; the existing Send action remains the only action
that starts an agent turn.

The renderer passes only an audio buffer and MIME type over a narrow IPC
boundary. The Electron main process validates the clip and sends it to
OpenAI's Audio transcription endpoint using `gpt-4o-mini-transcribe`. The
credential is read only from `OPENAI_API_KEY` in the main-process environment;
it is never exposed over IPC or stored in Roster's plaintext MCP configuration.
Audio is retained only in memory for the request.

This decision excludes spoken agent replies, live partial transcription,
task-comment recording, and a persistent in-app API-key settings surface.

## Consequences

* Voice input works with the same prompt review and session-send safeguards as
  typed chat, including plan mode.
* The OS microphone prompt is explicit, and failed recording or transcription
  leaves the typed draft untouched.
* Users must make `OPENAI_API_KEY` available to the launched app. A future
  settings feature may replace that requirement only with encrypted storage.
* The app incurs transcription API usage independently of the existing agent
  CLI subscriptions; Roster does not present it as their token spend.
