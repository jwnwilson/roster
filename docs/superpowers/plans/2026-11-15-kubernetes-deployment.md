# Roster on Kubernetes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Each phase is its own PR.

**Goal:** Run Roster as a headless service on a Kubernetes cluster, reachable from a
browser behind strong sign-in, where agents clone, build, run and improve projects
inside the cluster — and where both the agents and the user can inspect those running
projects in a browser, even though nothing in the cluster has a display.

**Why:** Agents should keep working when the laptop is closed, and projects should run
on hardware that is always on. This also covers the open `TODO.md` item *"deploy agents
to a provider like kubernetes … so I can have them work when roster is not running"*.

**Status:** Proposal. Deployment decisions are recorded in §0; the remaining open
questions are listed at the end.

---

## 0. Decisions

| Question | Decision | Consequence for this plan |
|---|---|---|
| Exposure | **Public internet; cluster access already in place** (dynamic DNS updater, port forwarding to k3s's Traefik) | Real TLS, rate limiting, and the in-app identity check (Phase 4.3) are mandatory, not optional. No tunnel needed |
| Domain | **`roster.jwnwilson.co.uk`, DNS in AWS Route 53, managed by Terraform in a separate repo** | Roster's records are added in that Terraform, not by the chart; previews optionally under `*.preview.roster.jwnwilson.co.uk` |
| TLS | **cert-manager already installed** | The chart ships only `Certificate`/`Issuer` resources, never cert-manager itself |
| Backups | **AWS S3** | Litestream + restic to an S3 bucket created in the same Terraform (§3c) |
| Identity | **Google sign-in through the existing Auth0 tenant** | A new Auth0 application for Roster with the Google social connection; oauth2-proxy uses Auth0 as its OIDC issuer; Roster verifies Auth0-issued JWTs |
| Cluster | **k3s (confirmed) on 64-bit Raspberry Pi nodes (8 GB and 16 GB), node-local storage** | arm64-only image built on native arm64 runners; Roster pinned to a 16 GB node, backing services allowed on 8 GB nodes; Traefik (bundled with k3s) is the ingress |
| Storage | **SD card (staying)** | The weakest part of the deployment. The plan is designed for SD: write reduction, memory-backed caches, and continuous off-node backup to S3 (§3b) |
| Users | **Single user** | One allowlisted Google account; no multi-user data model work |
| Backing services | **Probably needed** | Project services move earlier (Phase 5a now includes them) and are budgeted against Pi resources |

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
Browser ──HTTPS──▶ Ingress (Let's Encrypt TLS) ──forwardAuth──▶ oauth2-proxy ──▶ Auth0 ──▶ Google
                                               │  forwarded identity (Auth0 JWT)
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

1. `deploy/Dockerfile`, multi-stage, **`linux/arm64` only** (Raspberry Pi nodes; amd64
   can be added later at no design cost):
   - build stage: `npm ci --ignore-scripts`, build renderer + server, then
     `npm rebuild better-sqlite3 node-pty` against the **Node** ABI (the normal
     `postinstall` targets Electron's ABI and must not run here);
   - runtime: git, gh, node, python/uv, the agent CLIs, `@playwright/mcp`,
     `chrome-devtools-mcp`; non-root uid 1000; `HOME=/data/home`;
   - every component must have a linux/arm64 build — Claude Code, Codex, Pi, Playwright
     Chromium and Node all do; `browserless`-style amd64 images are avoided, Chromium
     comes from Debian or Playwright's arm64 build;
   - built on GitHub's native arm64 runners (`ubuntu-24.04-arm`), not QEMU emulation,
     which is slow and flaky for native module compilation.
2. `deploy/helm/roster`:
   - StatefulSet, `replicas: 1`, PVC mounted at `/data`, `ROSTER_HOME=/data/roster`;
   - `nodeSelector: kubernetes.io/arch: arm64` plus a `roster.dev/role=roster` node
     label applied to one 16 GB Pi; the PVC (k3s `local-path`) is node-local, so the
     pod stays bound to that node — the chart documents this and does not try to
     reschedule elsewhere;
   - storage follows §3b (designed for SD cards);
   - backup sidecars and their S3 credentials follow §3c;
   - Pi-sized resource defaults (see §3a) rather than desktop-sized ones;
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

Roster is publicly reachable, so every layer below is required. Outermost first:

1. **Reachability.** Public access to the cluster already exists (dynamic DNS updater,
   80/443 forwarded to Traefik). The separate Terraform repo adds a Route 53 `CNAME`
   `roster.jwnwilson.co.uk` → the existing dynamic-DNS hostname, and — if wildcard
   previews are wanted — `*.preview.roster.jwnwilson.co.uk` likewise. The existing
   cert-manager issues certificates from Let's Encrypt:
   - HTTP-01 for `roster.jwnwilson.co.uk` — works with no AWS access at all;
   - DNS-01 via cert-manager's Route 53 solver, only for the wildcard preview
     certificate (wildcards cannot use HTTP-01). k3s has no IRSA, so this uses a
     dedicated IAM user (Terraform-managed) whose policy allows
     `route53:ChangeResourceRecordSets` on the one hosted zone, restricted with
     `route53:ChangeResourceRecordSetsNormalizedRecordNames` to
     `_acme-challenge.preview.roster.jwnwilson.co.uk`, plus `route53:GetChange` and
     `ListHostedZonesByName`. Its keys live in a k8s Secret in the cert-manager
     namespace. If an issuer for Route 53 already exists in the cluster, reuse it.

   The chart ships a `deploy/terraform/` reference module (DNS records, the DNS-01 IAM
   user, the backup bucket and its IAM user from §3c) to copy into the existing
   Terraform repo; Roster never applies Terraform itself. Traefik middlewares: HTTPS redirect, HSTS, per-IP
   `rateLimit`, and `forwardAuth` to oauth2-proxy on every route. Nothing else on the
   cluster is exposed by this chart.
2. **Identity — Auth0 with Google.**
   - Create a **separate** Auth0 application (*Regular Web Application*) for Roster in
     the existing tenant, so its callback URLs, session lifetime and consent never
     interfere with the other app. Enable only the Google social connection on it.
   - Allowed callback URL `https://roster.jwnwilson.co.uk/oauth2/callback`; allowed
     logout URL `https://roster.jwnwilson.co.uk/`.
   - Create an Auth0 API with audience `https://roster.jwnwilson.co.uk/api` so issued
     access tokens are scoped to Roster.
   - Add an Auth0 post-login Action that denies any login whose verified email is not
     the owner's — the allowlist is enforced at the IdP, before a token exists.
   - Require MFA in Auth0 for this application (or rely on Google 2-step, enforced by
     the same Action checking `amr`).
   - oauth2-proxy runs with `--provider=oidc`, `--oidc-issuer-url=https://<tenant>.auth0.com/`,
     `--email-domain=*` plus `--authenticated-emails-file` containing the one address
     (a second allowlist, independent of Auth0), short cookie lifetime with refresh,
     `--cookie-secure`, `--cookie-samesite=lax` (strict breaks the OAuth redirect
     back from Auth0; CSRF on the RPC socket is covered by the Origin check),
     `--cookie-domain=.roster.jwnwilson.co.uk` so preview subdomains share the session,
     `--whitelist-domain=.roster.jwnwilson.co.uk`. Traefik's `forwardAuth` middleware
     points at it for every route.
3. **Defence in depth inside Roster.** `roster-server` verifies the forwarded Auth0
   access token against the tenant's JWKS — issuer, the Roster audience, expiry, and
   the allowlisted `sub` — on every HTTP request and WebSocket upgrade, and re-checks
   expiry on long-lived sockets. A client that reaches the pod without the proxy gets
   nothing. Preview and browser routes use the same check.
4. **Agent guardrails unchanged.** The approval gate and permission modes behave as on
   the desktop.

PR: `feat: verify proxy identity on every request` (+ Helm values for oauth2-proxy,
cert-manager issuer and ingress; an Auth0 setup checklist in `deploy/README.md`).

### Phase 5 — Agents build and run projects in the cluster

- **5a (first).** Projects clone into `/data/workspace/<project>`. Agents install,
  test, run dev servers, commit, push and open PRs with `gh` inside the Roster pod using
  the image's toolchains.
- **5a′ — backing services (pulled forward, since projects will need them).** Each
  project can declare services (Postgres, Redis, …) in a `roster.services.yaml` or
  chart values. Roster deploys them as small StatefulSets in a `roster-projects`
  namespace, reachable only from the Roster pod (NetworkPolicy), with arm64 images and
  Pi-sized limits. Agents get connection details as env vars in their session. Services
  are started on demand when a session for the project opens and scaled to zero when
  idle, because the Pis cannot hold every project's database in memory at once.
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
   subdomain routing (`<session>-<port>.preview.roster.jwnwilson.co.uk`, wildcard DNS +
   DNS-01 cert) is offered for apps that assume they live at `/`. Same authentication
   as everything else.
2. **Live browser panel.** A *Browser* tab in the session streams the agent's headless
   Chrome via CDP `Page.startScreencast` over the authenticated WebSocket, and forwards
   mouse and keyboard input — watch the agent, or take over. No X server or VNC.
3. **DevTools.** An authenticated proxy to the Chrome DevTools frontend for that target.

PRs: `feat: preview proxy`, `feat: live headless browser panel`

### Phase 7 (optional) — Desktop app as a remote client

A *Remote Roster* setting makes the Electron app use `remoteApi` against the cluster,
signing in through the same IdP with a loopback or device-code flow.

### 3a. Raspberry Pi resource budget

Roster runs on a 16 GB Pi; backing services may schedule onto the 8 GB nodes. Four
cores per node, shared with everything else running there. Defaults the chart ships
with, all overridable:

| Component | Node | Request | Limit | Notes |
|---|---|---|---|---|
| roster-server + agent processes + dev servers | 16 GB | 1 Gi / 1 CPU | 6 Gi / 3 CPU | `npm install`/builds are the real spike |
| headless Chromium sidecar | 16 GB | 256 Mi / 0.25 CPU | 2 Gi / 1 CPU | started lazily, one shared browser, a context per session |
| in-memory scratch (`emptyDir: Memory`) | 16 GB | — | 2 Gi | `/tmp`, npm/pip caches — keeps churn off the SD card (§3b) |
| each backing service | any | 128 Mi | 512 Mi | scaled to zero when idle |

Roster also caps concurrent agent turns (default 3) on this deployment, so a burst of
handoffs cannot push the node into OOM. Voice transcription (local model) is disabled by
default on the server: it is the heaviest single feature and gains nothing over the
browser's own input.

### 3b. Storage on SD cards

SD cards wear out under small random writes and corrupt on power loss — exactly the
pattern of SQLite, git and `node_modules`. The cluster stays on SD, so the deployment
assumes **the card will eventually fail** and makes that a restore, not a loss:

- use a high-endurance card on the Roster node; mount with `noatime`;
- SQLite in WAL mode with `synchronous=NORMAL`;
- caches, `/tmp` and build output on a memory-backed `emptyDir` (§3a), not the card;
- workspaces are treated as disposable: agents push branches early and often, so a
  lost card loses at most uncommitted work, and Roster can re-clone;
- Roster state is continuously backed up to S3 (§3c);
- a documented restore procedure onto another Pi, tested once as part of Phase 3.
- Backing services' data (5a′) is development data and is not backed up by default.

A USB SSD on the Roster node remains an optional later upgrade; nothing in the chart
changes if one is added.

### 3c. Backups to S3

- **Bucket** (Terraform, separate repo): e.g. `jwnwilson-roster-backups`, in the region
  the rest of the AWS estate uses; versioning on, SSE-S3 (or SSE-KMS) encryption, block
  all public access, lifecycle rule expiring non-current versions after 30 days.
- **Credentials:** k3s has no IRSA, so a dedicated IAM user with access only to
  `s3://jwnwilson-roster-backups/roster/*` (`GetObject`, `PutObject`, `DeleteObject`,
  `ListBucket` with a prefix condition). Keys in a k8s Secret in the Roster namespace,
  rotated on a schedule. IAM Roles Anywhere is an option later to remove long-lived keys.
- **What runs:**
  - Litestream sidecar replicating `roster.db` continuously to `roster/litestream/`
    (seconds of data loss at most);
  - a nightly restic CronJob snapshotting the rest of `/data/roster` — `agent.toml`s,
    skills, plans, MCP config — to `roster/restic/`, keeping 7 daily and 4 weekly;
  - workspaces and agent CLI credentials are **not** backed up: the former live in
    GitHub, the latter are re-created from their k8s Secrets.
- **Restore:** an init container runs `litestream restore -if-replica-exists` and
  `restic restore latest` when `/data/roster` is empty, so rescheduling Roster onto a
  fresh Pi brings it back automatically.
- **Egress:** the NetworkPolicy allows the S3 regional endpoint.

## 4. Risks

| Risk | Mitigation |
|---|---|
| Linux paths untested | Container smoke test in Phase 2 CI: start server, open a session, run a pty |
| Single replica → brief outage on redeploy | Acceptable for single-user; `Recreate` semantics, graceful shutdown cancels turns cleanly |
| Node-local volume → node failure takes Roster down | Accepted for single-user; S3 backups (§3c) and automatic restore onto another Pi |
| SD card wear / corruption | §3b: write reduction, memory-backed caches, continuous S3 backup, tested restore |
| Long-lived AWS keys in the cluster (no IRSA on k3s) | Two single-purpose IAM users scoped to one zone record / one bucket prefix; rotation; Roles Anywhere later |
| Pi memory pressure (builds + Chromium + services) | §3a limits, concurrent-turn cap, lazy browser, idle services scaled to zero |
| Public exposure of an RCE-capable API | Auth0 Action allowlist + oauth2-proxy allowlist + in-app JWT check; Traefik rate limiting; only Roster's routes exposed |
| Long-lived agent/GitHub tokens in the pod | k8s Secrets, rotation, scoped tokens; never mounted into 5b sandboxes |
| Pty/RPC surface is RCE if exposed | Three independent layers in Phase 4; NetworkPolicy; server verifies identity itself |
| `ipc/index.ts` is coverage-excluded today | Logic moves to the core, which is covered at the normal thresholds |

## 5. Open questions

All deployment questions are answered. Two minor choices can be made during Phase 3/6
without blocking earlier phases:

1. Wildcard preview subdomains, or path-based previews only? Path-based needs no AWS
   access; wildcard needs the DNS-01 IAM user in Phase 4, step 1.
2. Is there already a Route 53 `ClusterIssuer` in the cluster to reuse?
