# ADR 0015: One portable voice path, without the Apple helper

## Status

Accepted — 2026-10-18. Supersedes ADR 0014's dark-launch/Apple rollback policy
and retires ADR 0011's native Speech runtime. This is a default-selection
decision, not a claim that the cross-platform manual acceptance matrix passed.

## Context

PR #124 shipped TypeScript capture, model management, and a Transformers.js
Web Worker, but the default remained Apple on macOS and disabled elsewhere.
PR #125 fixed installation, not selection. The macOS Launch Services wrapper
also omitted the engine environment variable, undermining the documented opt-in.
The user reports continued voice failures and explicitly requests a single
platform-agnostic implementation, preferably TypeScript.

## Decision

Use the existing Transformers.js/ONNX Runtime Web WASM worker by default on all
platforms. Remove the Swift executable, Apple Speech adapter, start/stop IPC,
Speech permission metadata, and compilation/signing hooks. A legacy `apple`
override maps to the portable engine instead of reviving the broken path.
`off` remains an explicit disable switch, including through Launch Services.

Retain microphone permissions, narrow renderer media access, and the macOS
application-launch infrastructure. Capture still requires explicit user action.
Model download requires first-use consent; pinned hashes are verified before
loading. Audio stays in memory and is never uploaded. Returned text remains
editable and is never automatically submitted. No hosted fallback is allowed.

Application orchestration stays TypeScript. The inference engine is bundled
WebAssembly, not TypeScript alone. Whisper is an OpenAI-origin model, not use
of OpenAI's hosted service. The initial model is English-only and approximately
45 MB. Inference explicitly chunks clips so the 60-second UI limit does not
silently become a 30-second model truncation limit.

## Consequences and verification

This deliberately replaces the staged native rollback from ADR 0014 at the
user's request. An unverified native fallback is not retained as a recovery
strategy; typed input and the explicit disable switch remain available.

Regression tests cover platform defaults, absence of helper build/IPC paths,
microphone cleanup, cancellation of pending startup/decode/inference, worker
single-flight and stale job isolation, chunking, and editable/no-auto-send text.
The production build verifies that matching WASM assets are bundled.

Before declaring voice fully validated, record packaged macOS/Windows/Linux
checks for first download, cached offline inference, real microphone permission
denial/retry, cancellation, 5- and 60-second clips, and editable insertion without
submission. CI/unit tests are not substitutes for those human/device checks.
