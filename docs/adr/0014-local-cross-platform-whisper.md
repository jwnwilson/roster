# ADR 0014: Local voice transcription uses a portable Whisper worker

## Status

Accepted — 2026-10-17. The portable engine is implemented behind an explicit
rollout switch until its packaged macOS, Windows and Linux acceptance matrix is
complete.

## Context

ADR 0011 replaced hosted OpenAI transcription with an Apple Speech helper. It
kept audio local, but made voice input macOS-only and dependent on Speech/TCC,
Siri/Dictation availability and a separately compiled native executable. ADRs
0012 and 0013 repaired development permission identity, but could not make that
runtime portable.

Roster needs the same reviewed-draft behaviour on macOS, Windows and Linux.
Chromium SpeechRecognition remains unsupported for the reasons in ADR 0010,
and an implicit hosted fallback would reverse the privacy decision.

## Decision

Use Transformers.js and ONNX Runtime Web in a dedicated renderer Web Worker.
The compatibility baseline is a pinned, quantized Whisper tiny.en model on
WASM/SIMD with one thread and one transcription at a time. WebGPU is a later,
capability-gated acceleration experiment; it is not a release requirement.

The renderer explicitly records a completed WebM/Opus clip, decodes it with
Web Audio, downmixes and resamples it to 16 kHz mono PCM, and transfers that
buffer to the worker. Neither encoded nor decoded audio crosses Electron IPC
or is written to disk. The worker can return text only; the composer inserts
that text into its editable draft and never sends it.

The main process owns model download and storage, not inference. A checked-in
manifest pins the Hugging Face revision, exact file allowlist, byte sizes and
SHA-256 hashes. Downloads use temporary files and atomic promotion. A secure
custom protocol exposes only a completely verified model to the worker.
Transformers.js and matching ONNX WASM runtime assets ship with Roster; runtime
code is never loaded from a CDN.

Do not bundle the model in the installer. First use explains that transcription
is local, discloses the approximately 45 MB download, and asks before fetching.
Once verified, the cache under Roster's Electron user-data directory works
offline and follows `ROSTER_HOME` isolation.

During rollout, `ROSTER_VOICE_ENGINE=transformers|apple|off` is the explicit
selection and rollback boundary. The default remains Apple on macOS and off on
other platforms until the manual packaged acceptance matrix is recorded. After
that gate, Transformers becomes the default everywhere and Apple remains an
explicit macOS rollback for one release. It must never be selected silently
after a Transformers failure.

## Alternatives

`whisper.cpp` is fast, local and cross-platform, but a TypeScript wrapper still
ships native executables or addons for every OS, CPU and Linux libc and repeats
the signing, notarization and launch-boundary risks exposed by the Apple helper.
It remains a contingency only if measured WASM performance is unacceptable.

Hosted transcription is rejected. It would upload audio, require credentials,
network and cost policy, and contradict the privacy goal.

## Consequences

The installer grows by the local ONNX/WASM runtime, and first use needs a model
download. Inference consumes appreciable CPU and memory, so recordings are
limited to 60 seconds, concurrency to one job, and cancellation terminates the
worker. The baseline worker is disposed after two idle minutes.

Live/partial transcription, multilingual selection, VAD, diarization, spoken
replies, hotwords, cloud fallback and models larger than tiny.en are not part of
this decision. The Swift helper, Speech privacy key and its build hooks remain
until the rollback window closes. The microphone privacy key remains after
their eventual removal.
