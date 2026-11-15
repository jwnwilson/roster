# Roster on Kubernetes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Each phase is its own PR.

**Goal:** Run Roster as a headless service on a Kubernetes cluster, reachable from a
browser behind strong sign-in, where agents clone, build, run and improve projects
inside the cluster — and where both the agents and the user can inspect those running
projects in a browser, even though nothing in the cluster has a display.

**Why:** Agents should keep working when the laptop is closed, and projects should run
on hardware that is always on. This also covers the open `TODO.md` item *"deploy agents
to a provider like kubernetes … so I can have them work when roster is not running"*.

**Status:** Proposal. Open questions are listed at the end and should be answered before
Phase 3.

---

## 1. What the code tells us

- **Electron is confined to a handful of files.** `electron/main/index.ts` (window,
  lifecycle), `electron/main/ipc/index.ts` (81 `ipcMain.handle` calls),
  `electron/main/voice/modelProtocol.ts` (`roster-model://` scheme) and
  `electron/main/desktop/testWindow.ts`. Runners, stores, sessions, pty, db and auth are
  plain Node. A headless server is a transport problem, not a rewrite.
- **The renderer only ever calls `window.roster`** — the `RosterApi` contract in
  `shared/ipc.ts`. A browser implementation of that object lets the React app run
  unmodified.
- **Electron-only behaviour is small and enumerable:**
  | Call | Used for | Server replacement |
  |---|---|---|
  | `safeStorage` | Notion `SecretBox` | AES-256-GCM keyed by `ROSTER_SECRET_KEY` (k8s Secret) |
  | `dialog.showMessageBox` | confirm session delete | renderer modal; confirmation stays mandatory |
  | `dialog.showOpenDialog` | `dialogChooseDirectory` | server-side directory browser rooted at `/data` |
  | `shell.openExternal` / `openPath` / `showItemInFolder` | links, reveal | return a URL for the browser to open; reveal disabled |
  | `protocol` (`roster-model://`) | voice model files | plain authenticated HTTP route |
  | `BrowserWindow` | window controls, desktop-control test | hidden / feature disabled in server mode |
  | `Updater` | GitHub release updates | no-op; the image tag is the version |
- **The API is remote code execution by design.** `pty.open/write`, `skills.write`, agent
  `cwd`, MCP server commands. Authentication is therefore the most important part of
  this plan, not an add-on.
- **State is single-process.** SQLite plus live ptys and in-flight turns mean one
  replica: a StatefulSet with `replicas: 1`, not a scalable Deployment.
- **Linux is untested** (README). node-pty, CLI auth detection and path handling must be
  verified in the container early.
- **Interaction with the Pi backend plan** (`2026-11-13-pi-agent-backend.md`): this plan
  is backend-agnostic. Whichever runner is current, credentials end up as files or env
  vars in the pod; only Phase 3's secret wiring differs (CLI tokens vs Pi `auth.json`).

## 2. Target architecture

```
Browser ──HTTPS──▶ Ingress / Tailscale ──▶ oauth2-proxy (OIDC, email allowlist, MFA at IdP)
                                               │  forwarded identity (JWT)
                                               ▼
          ┌──────────────── roster pod (StatefulSet, 1 replica) ─────────────────┐
          │ roster-server (Node 22)                                              │
          │   GET  /                         built renderer                      │
          │   WS   /rpc                      RosterApi: invoke, events, pty      │
          │   ANY  /preview/<session>/<port> reverse proxy to project dev server │
          │   WS   /browser/<session>        CDP screencast + input              │
          │ agent backends (claude / codex / pi), git, gh, node, python, uv      │
          │ sidecar: headless Chromium, CDP on 127.0.0.1:9222                    │
          └── PVC /data: roster/ (ROSTER_HOME), workspace/, home/.claude, .codex ┘
```

## 3. Phases

### Phase 1 — Extract an Electron-free core (no behaviour change)

1. Move store/manager construction and handler bodies out of `ipc/index.ts` into
   `electron/core/`: `createRosterCore(platform)` returns a handler map keyed by
   `CHANNELS` and an event emitter that replaces `broadcast()`.
2. Introduce a `Platform` interface covering every row of the table in §1.
   `electron/main/platform.ts` implements it with Electron; tests use a fake.
3. `ipc/index.ts` becomes a thin adapter: `ipcMain.handle(ch, (_e, ...a) => core[ch](...a))`.
4. Tests first: a test asserting every `CHANNELS` invoke entry has a core handler; unit
   tests for the moved logic now that it is no longer excluded from coverage.

PR: `refactor: extract electron-free roster core`

### Phase 2 — `roster-server`, the headless mode

1. `server/index.ts`, built as a separate target to `out/server`, runs on plain Node 22.
2. One WebSocket at `/rpc` carrying JSON-RPC: request/response for invokes, server push
   for subscribed events, and multiplexed pty streams (`pty.open/write/resize/close`).
3. `src/lib/remoteApi.ts` builds `window.roster` from `CHANNELS` over that socket, with
   reconnect and resubscribe. `src/main.tsx` uses the preload bridge when present and
   `remoteApi` otherwise. Window chrome and desktop-only features hide in web mode.
4. Hardening in the server itself: bind to the pod IP only, strict `Origin` check on
   upgrades, CSP on the served renderer, `/healthz` and `/readyz`.
5. `auth/detect.ts` recognises env-based auth on Linux (`CLAUDE_CODE_OAUTH_TOKEN`,
   `OPENAI_API_KEY` / `CODEX_API_KEY`) as signed in.
6. Tests: RPC round-trip, event fan-out to multiple clients, pty multiplexing,
   reconnect. End-to-end: drive the served renderer with a headless browser the same way
   `ROSTER_SCRIPT` drives Electron.

PR: `feat: run roster as a headless web server`

### Phase 3 — Container image and Helm chart

1. `deploy/Dockerfile`, multi-stage, `linux/amd64` + `linux/arm64`:
   - build stage: `npm ci --ignore-scripts`, build renderer + server, then
     `npm rebuild better-sqlite3 node-pty` against the **Node** ABI (the normal
     `postinstall` targets Electron's ABI and must not run here);
   - runtime: git, gh, node, python/uv, the agent CLIs, `@playwright/mcp`,
     `chrome-devtools-mcp`; non-root uid 1000; `HOME=/data/home`.
2. `deploy/helm/roster`:
   - StatefulSet, `replicas: 1`, PVC mounted at `/data`, `ROSTER_HOME=/data/roster`;
   - Secrets for agent credentials, a GitHub token (fine-grained PAT or GitHub App) for
     push/PR, and `ROSTER_SECRET_KEY` — compatible with External Secrets / Sealed Secrets;
   - `automountServiceAccountToken: false`, `runAsNonRoot`, dropped capabilities,
     `seccompProfile: RuntimeDefault`, resource requests/limits;
   - NetworkPolicy: ingress only from the auth proxy; egress only to DNS, model
     providers, GitHub and package registries (overridable).
3. A new workflow builds and pushes to GHCR on release tags. `release.yml` is not
   touched, so the desktop release pipeline is unaffected.

PR: `feat: container image and helm chart`

### Phase 4 — Secure sign-in

Layered, outermost first:

1. **Reachability.** Preferred: tailnet only via the Tailscale operator (or Cloudflare
   Access) — nothing is exposed to the internet. Otherwise ingress-nginx with
   cert-manager TLS.
2. **Identity.** oauth2-proxy in front of every route, against GitHub, Google or an
   existing IdP (Authentik/Keycloak). Allowlist the owner's email/GitHub user; enforce
   MFA at the IdP.
3. **Defence in depth inside Roster.** `roster-server` verifies the forwarded OIDC JWT
   against the IdP's JWKS (issuer, audience, expiry, allowlisted subject) on every HTTP
   request and WebSocket upgrade, so a client that reaches the pod without the proxy
   gets nothing. Session cookies `Secure; HttpOnly; SameSite=Strict`. Preview and
   browser routes use the same check.
4. **Agent guardrails unchanged.** The approval gate and permission modes behave as on
   the desktop.

PR: `feat: verify proxy identity on every request` (+ Helm values for oauth2-proxy and
the Tailscale operator).

### Phase 5 — Agents build and run projects in the cluster

- **5a (first).** Projects clone into `/data/workspace/<project>`. Agents install,
  test, run dev servers, commit, push and open PRs with `gh` inside the Roster pod using
  the image's toolchains. Backing services a project needs (Postgres, Redis) are
  optional sidecars declared in chart values.
- **5b (later).** A sandbox pod per project (or per session), built from the repo's
  devcontainer or a chosen image, in a dedicated namespace with a narrowly scoped Role,
  ResourceQuota and default-deny NetworkPolicy. Roster runs commands there through the
  Kubernetes exec API. This isolates projects from each other and from Roster's own
  credentials. No privileged Docker-in-Docker; rootless BuildKit if images must be built.

### Phase 6 — Browser inspection, headless

**For agents**
- Headless Chromium sidecar exposing CDP on `127.0.0.1:9222` only.
- Default MCP config adds `@playwright/mcp --cdp-endpoint http://127.0.0.1:9222` and
  `chrome-devtools-mcp`: navigation, interaction, console and network logs, screenshots,
  performance traces.
- One browser context per session, so sessions never share cookies or storage.
- Screenshots an agent takes are attached to the session transcript.

**For the user**
1. **Preview proxy.** Roster detects ports a session's processes listen on and offers
   *Open preview*. Path routing (`/preview/<session>/<port>/`) works out of the box;
   subdomain routing (`<session>-<port>.preview.<domain>`, wildcard DNS + cert) is
   offered for apps that assume they live at `/`. Same authentication as everything else.
2. **Live browser panel.** A *Browser* tab in the session streams the agent's headless
   Chrome via CDP `Page.startScreencast` over the authenticated WebSocket, and forwards
   mouse and keyboard input — watch the agent, or take over. No X server or VNC.
3. **DevTools.** An authenticated proxy to the Chrome DevTools frontend for that target.

PRs: `feat: preview proxy`, `feat: live headless browser panel`

### Phase 7 (optional) — Desktop app as a remote client

A *Remote Roster* setting makes the Electron app use `remoteApi` against the cluster,
signing in through the same IdP with a loopback or device-code flow.

## 4. Risks

| Risk | Mitigation |
|---|---|
| Linux paths untested | Container smoke test in Phase 2 CI: start server, open a session, run a pty |
| Single replica → brief outage on redeploy | Acceptable for single-user; `Recreate` semantics, graceful shutdown cancels turns cleanly |
| SQLite on a PVC | Volume snapshots or Litestream backups; never `ReadWriteMany` |
| Long-lived agent/GitHub tokens in the pod | k8s Secrets, rotation, scoped tokens; never mounted into 5b sandboxes |
| Pty/RPC surface is RCE if exposed | Three independent layers in Phase 4; NetworkPolicy; server verifies identity itself |
| `ipc/index.ts` is coverage-excluded today | Logic moves to the core, which is covered at the normal thresholds |

## 5. Open questions

1. Exposure: tailnet-only (Tailscale / Cloudflare Access) or public with oauth2-proxy?
2. Identity provider: GitHub, Google, or an existing Authentik/Keycloak?
3. Cluster: ingress controller, cert-manager present, storage class, amd64 vs arm64?
4. Single user, or several? Multi-user changes the data model substantially and is out
   of scope here.
5. Do target projects need backing services, which would pull Phase 5b forward?
