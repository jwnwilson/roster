# ADR 0016: Reject unusable microphone input before local inference

## Status

Accepted — 2026-10-18. Extends ADR 0015; the local model/runtime is unchanged.

## Context and evidence

The user reports repeated "you" instead of their dictation. We reproduced that
exact output from three seconds of zero PCM using the pinned tiny.en q8 weights
and ONNX Runtime Web's WASM provider in Node. The same runtime correctly decoded
the known JFK speech fixture, including a copy attenuated by a factor of 0.001.
This demonstrates a silence hallucination, but does not establish whether the
user's microphone supplied poor audio or why. It is not a microphone or packaged
Electron test.

Observed PCM RMS and results:

| Input | RMS | Model output |
|---|---:|---|
| Digital silence | 0 | "you" |
| Known speech | 0.142 | Correct reference speech |
| Speech multiplied by 0.001 | 0.000142 | Correct reference speech |
| Speech multiplied by 0.0001 | 0.0000142 | Speech with recognition errors |
| Speech multiplied by 0.00001 | 0.00000142 | "you" |
| Deterministic quiet noise | 0.0000289 | "you" |

## Decision

Before inference, validate normalized PCM and require at least 120 ms of signal
above RMS 0.0001 (-80 dBFS), measured in 20 ms frames after subtracting DC energy.
Use active-frame duration, not whole-recording average: silence around a short
utterance must not dilute its signal below the threshold. Reject empty, invalid,
constant/DC, and near-silent input with an actionable microphone error. Do not
insert guessed text or modify the existing draft on these errors.

Show a local live input-level meter while recording. Explain when no signal is
detected and suggest checking the input device/speaking closer. The indicator
measures energy, not speech, and failure of optional monitoring must not disable
recording. Stop its timers and release audio nodes/contexts with capture.

Do not blacklist "you", boost noise through automatic normalization, or change
model size without comparative evidence. Keep audio in memory; no recording or
transcript telemetry is added. Do not pass Python Whisper configuration flags
that this installed Transformers.js implementation does not support.

## Tradeoffs and verification

This is not a VAD or a general hallucination detector. Louder noise may pass;
extremely quiet speech may be rejected with a retry message. The chosen floor
preserves the tested correctly recognized quiet clip but rejects the tested noise.
Microphone selection and real-device acceptance remain follow-up checks.

Unit tests exercise silence, DC, clicks, near-silent noise, quiet/short input,
invalid samples, worker rejection without inference, legitimate "you" output,
and live-monitor lifecycle. An opt-in real-model regression uses checksum-verified
weights and a checksum-pinned public fixture; it downloads nothing and accesses
no microphone. It explicitly uses Node WASM, not native ONNX or the full browser
worker path. See README for the command.
