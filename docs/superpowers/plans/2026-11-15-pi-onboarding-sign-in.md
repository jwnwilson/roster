# Pi Onboarding & Provider Sign-In Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Tests first for every step.

**Goal:** A fresh install with nothing else on the machine reaches a working agent from the welcome card: sign in to a model provider without leaving Roster, then "Start with Tech Lead".

**Why:** Pi ships inside the app (verified: v0.1.74's `app.asar` loads Pi 1.5.2 under Electron's Node with an empty `HOME` and bare `PATH`). But a new machine has no signed-in provider, and today that is a dead end:

1. `prepareFirstRun` seeds the three starter agents against Pi (`installed: true`, `ready: false`) with model `''`, because `defaultModel()` has nothing signed in to pick.
2. The welcome card says "Start with Tech Lead".
3. The first turn reaches `PiRunner.run()` with a blank model. The in-turn sign-in only fires for a *named* model (`unsigned` needs `options.model !== ''`), so it fails with **"Pi has no signed-in model provider — run `pi` and then `/login`"**. A new user has no `pi` command.
4. `FirstRunCard`'s `noRunner` text still says "Install Claude Code or Codex", which is wrong since ADR 0017.

Users upgrading from the Claude/Codex era hit the same wall without ever seeing the card: their marker is already dismissed and their Pi has no credentials.

**Non-goals:** Changing the in-turn sign-in (it stays as the fallback), bundling `rg`/`fd`, a multi-step wizard, managing credentials beyond sign-in/sign-out.

**What already works and is reused:**

| Need | Existing piece |
|---|---|
| Run a provider's login in process | `runtime.login(provider, 'oauth' \| 'api_key', interaction, { getDeviceId })` in `PiRunner.signIn` |
| Map Pi's login prompts to questions | `loginInteraction()` in `runners/pi/signIn.ts` (URL → browser, device code → shown, text/secret/select → question) |
| Which ways in a provider has | `signInMethods()` |
| Human-readable failures | `explainSignInFailure()` |
| Blank model once signed in | `resolveModel('', available, preferred)` falls back to Pi's default or the first available model, so seeded agents need no rewrite |
| Status re-detect | `runners:list` re-runs `detect()` and reloads agents when `ready` flips |

---

## Phase 1 — Sign-in outside a turn (main process)

The sign-in logic is currently fused to a turn: its prompts go through `this.ask(..., options.onApproval)`, which is session-bound. Pull it apart so the same flow can be driven from a modal.

- [ ] **Extract** the body of `PiRunner.signIn` after the "ask first" step into `PiRunner.login(providerId, method, interaction, signal): Promise<true | string>`. It builds the runtime, calls `runtime.login` with the same `getDeviceId` option, calls `forgetProvider` on success, and returns `explainSignInFailure(...)` on failure. The in-turn `signIn` calls it. Existing runner tests must pass unchanged.
- [ ] **`PiRunner.providers(): Promise<ProviderSummary[]>`**: `{ id, name, signedIn, subscription, methods: SignInMethodOption[] }` from `runtime.getProviders()`, `getAvailable()` and `isUsingSubscription()`. Drop providers with no methods. Order: subscription OAuth providers first (Anthropic, OpenAI Codex, GitHub Copilot, Google), then API-key providers alphabetically. Add the type to `shared/types.ts`.
- [ ] **`PiRunner.logout(providerId)`**: wraps `runtime.logout` and calls `forgetProvider`. It is cheap to add here, and the settings entry point in Phase 3 needs it.
- [ ] **IPC** (`shared/ipc.ts`, `electron/main/ipc/index.ts`, preload):
  - `pi:providers` → `ProviderSummary[]`
  - `pi:signIn(providerId, method)` → `{ ok: true } | { ok: false, message }`. It starts one login, with an `AbortController` per call, and rejects a second concurrent call with "a sign-in is already in progress" (Pi's OAuth callback port is single-use; see the `EADDRINUSE` branch of `explainSignInFailure`).
  - `pi:signInCancel()` aborts it.
  - Events to the renderer: `pi:signInPrompt` `{ promptId, question: Question }` and `pi:signInNotice` `{ text }` (device code, "waiting for browser…"). Answers come back over `pi:signInAnswer(promptId, answer | null)`.
  - The interaction is `loginInteraction({ signal, openUrl, ask, tell })`, where `ask` emits `signInPrompt` and awaits `signInAnswer` (and withdraws on the prompt's own signal), and `tell` emits `signInNotice`.
  - On success: re-run `detectRunners()`, reload agents if `ready` flipped, and push the new runner list so the grid's "not signed in" states clear without a restart.
- [ ] **Tests** (`runners/pi/runner.test.ts`, `ipc` tests with a fake runtime): `providers()` order and filtering; `login` success calls `forgetProvider`; failure is explained; abort returns "cancelled"; a concurrent second sign-in is rejected; the prompt round trip resolves `interaction.prompt`; a `null` answer cancels.

## Phase 2 — The welcome card signs you in (renderer)

The card is driven by **runner status as well as the first-run marker**, so upgraders without credentials see it too.

- [ ] **`SetupState.needsSignIn: boolean`**, computed in `ipc/index.ts` from `runners.get('pi')` (`installed && !ready`) and refreshed on `runners:list`. It is not persisted: once you sign in, it is gone. `FirstRunCard` renders when `setup.pending || setup.needsSignIn`.
- [ ] **Card states** (`src/components/FirstRunCard.tsx`):
  1. *Needs sign-in* (new or upgrading): "Welcome to Roster. Agents run on your own model account — sign in to one to start." Primary buttons for the top subscription providers ("Sign in with Claude", "Sign in with ChatGPT" (OpenAI Codex), "GitHub Copilot"), plus "Other provider / API key…", which opens the full list. The "Start with Tech Lead" button is hidden in this state.
  2. *Signed in, first run pending*: today's text with "Start with **Tech Lead**", adding "Running on {provider} · {model}".
  3. *`noRunner`* (Pi failed to load, now an internal error): replace the Claude/Codex text with "Roster could not start its agent engine: {detail}" and a "Copy details" button. Do not tell the user to install anything.
  - Dismiss on state 1 hides the card for the session only. It reappears next launch while nothing is signed in, because nothing can run.
- [ ] **`SignInModal`** (`src/components/SignInModal.tsx`): pick a provider and method (when there are two) → `pi:signIn`. Render each `signInPrompt` question with the existing question UI from the approval banner (extract it from `AgentDetail.tsx` if it is not already a component), with a `secret` prompt rendered as a password field. Show `signInNotice` text (device code in a copyable mono block). Cancel calls `pi:signInCancel`. A failure shows the explained message with "Try again"; success closes and toasts "Signed in to {provider}".
- [ ] **Store** (`src/state/store.ts`): `providers`, `signIn(providerId, method)`, and subscriptions to the prompt and notice events. Refresh `runners` and `setup` on completion.
- [ ] **Tests** (renderer project): each card state; dismiss in the needs-sign-in state doesn't call `setup.dismiss` permanently; the modal round trip with a mocked `window.roster.pi` (prompt → answer → success); cancel; error then retry.

## Phase 3 — Copy fixes and a second way in

- [ ] Replace both "run `pi` and then `/login`" strings in `runner.ts` (`detect()` detail, and the `run()` error when `available.length === 0`) with "No model provider is signed in — sign in from the welcome card or Settings → Model providers". Update the tests that assert the old text.
- [ ] Remove the remaining `pi auth login …` hint in `signIn()`'s "no sign-in Roster can run" message, or keep it but lead with Roster's own path.
- [ ] **Settings → Model providers** list (where runner status is shown today, `AgentFields`/settings): each provider with a status of signed in / subscription / not signed in, and Sign in / Sign out actions using the same modal. This is the path for adding a second provider or recovering from an expired login after the card is gone.
- [ ] `AgentFields` "not signed in — the agent will ask to sign in when it first runs" gains a "Sign in now" link that opens the modal for that provider.

## Phase 4 — Fresh-machine verification

- [ ] **E2E** (existing harness, `ROSTER_HOME=$(mktemp -d)` plus `PI_CODING_AGENT_DIR=$(mktemp -d)` so the developer's own `~/.pi/agent/auth.json` isn't picked up): the card shows the needs-sign-in state; sign in with an API-key provider using a fake key against a stubbed provider, or assert up to the prompt; the card flips to "Start with Tech Lead".
- [ ] **Manual, packaged build** on a clean macOS user account (or `HOME=$(mktemp -d)` with `PATH=/usr/bin:/bin`): install the DMG, OAuth with Claude and with ChatGPT, open Tech Lead, send a message, run `grep` (this triggers Pi's first-use `rg` download into `~/.pi/agent/bin`), and run `bash`. Record the results in the PR.
- [ ] `npm run check`.

## Later / open questions

- **Offline `rg`/`fd`:** Pi downloads them from GitHub on first `grep`/`find` when they aren't on `PATH`. `ensureTool` is not exported (the package `exports` only `.` and `./rpc-entry`), so Roster can't prefetch them during onboarding. Options: ask upstream to export it, bundle per-arch binaries in `extraResources` and prepend to `PATH` (this widens `afterPack`'s arch guard to cover them), or accept it. Decide after Phase 4 shows how it behaves on a restricted network.
- **Credential location:** Pi uses `~/.pi/agent/auth.json`, shared with any `pi` CLI on the machine. That is good for people who have both, but `ROSTER_HOME` doesn't isolate it, so dev and e2e runs must set `PI_CODING_AGENT_DIR`. Consider making `ROSTER_HOME` imply a Pi agent dir in dev only.
- Should seeded agents be rewritten from `''` to the concrete default model after the first sign-in? This isn't needed for them to run (`resolveModel` handles it), but it would make the model visible on the agent card. Leaning towards no: blank means "follow Pi's default", which follows later sign-ins too.

## PRs

1. `feat/pi-sign-in-ipc`: Phase 1 (no UI change; in-turn sign-in refactored onto `login`).
2. `feat/onboarding-sign-in`: Phase 2 plus the copy fixes from Phase 3.
3. `feat/model-providers-settings`: the rest of Phase 3.
4. Phase 4 checks go in each PR's description; the e2e test lands with PR 2.
