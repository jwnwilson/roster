# Per-agent workspaces, skills that actually load, and shareable agents

## What this is

A bug fix, not a relocation. Nothing on disk moves.

`~/roster` stays the global home for everything Roster owns — agents, plans,
projects, skills, `mcp.json`, `roster.db`, `setup.json`. Every agent reads those
from `~/roster` no matter where it is working.

What changes is the working directory. Each agent gets one, and it is an
**optional project**: point it at a repo and the agent works on those files;
leave it unset and the agent gets a private scratch folder of its own, scoped
under `~/roster/workspace/`, rather than sharing one with the whole roster.

Three bugs sit behind that sentence. Two of them mean the "reads those from
`~/roster`" half is not true today.

---

## Bug 1 — every agent shares one working directory

`join(rosterHome(), 'workspace')` is the default `cwd` for every agent that does
not name its own. It is written out three times — `store/defaultAgents.ts:81`,
`ipc/index.ts:327`, `store/seed.ts:83` — and is absent from `store/paths.ts`,
which owns every other Roster path.

So a fresh install seeds a Tech Lead, an Implementer and a Reviewer that all
work in the same directory, on each other's files, with no way to tell whose is
whose.

### The folder name

Keyed on the agent's **id**, reusing the logic that is already there. The name
itself does not matter; being unique does, and `AgentStore.create` already
guarantees that at `agents.ts:102`:

```ts
const id = this.uniqueId(slugify(name))
```

`slugify` (`agents.ts:32`) lowercases and hyphen-joins, and `uniqueId`
(`agents.ts:126`) suffixes `-2`, `-3`, … against both live agents and failed
ones. Two agents cannot share an id, so two agents cannot share a folder.

This matters even though `assertNameIsFree` already rejects a duplicate *name*,
because distinct names can still slugify to the same string — "Tech Lead" and
"Tech Lead!" are both `tech-lead`, and only `uniqueId` separates them.

The id is also what `~/roster/agents/<id>/` is already named, so one agent is one
word in both places, and it never changes when the agent is renamed
(`shared/agentName.ts`: the name is a label, the id is the identifier) — so a
rename cannot strand the files an agent has been working on.

### The fix

Add to `store/paths.ts`, beside the others:

```ts
/**
 * The root of the scratch workspaces, for agents not pointed at a project.
 *
 * Inside Roster's home because a fresh install has nowhere else to point,
 * and an agent loose in the user's home directory is worse.
 */
export function workspaceDir(): string {
  return join(rosterHome(), 'workspace')
}

/**
 * An agent's own scratch directory.
 *
 * Keyed on the id, not the name: the id is already unique and already the
 * agent's directory under `agents/`, and it does not change when the agent is
 * renamed — so a rename never strands the files the agent has been working on.
 */
export function agentWorkspaceDir(agentId: string): string {
  return join(workspaceDir(), agentId)
}
```

Then **move the default out of the IPC layer**. `ipc/index.ts:327` cannot
resolve it any more, because the id does not exist until the store mints it. So:

- `NewAgentInput.cwd` becomes genuinely optional at the store boundary, and
  `AgentStore.create` fills it with `agentWorkspaceDir(id)` immediately after
  `uniqueId`. `agents.ts:121` already does `mkdir(config.cwd, {recursive:true})`,
  so the directory appears on creation with no extra code.
- `ipc/index.ts:327` drops its `?? join(rosterHome(), 'workspace')` and passes
  the input through.
- `defaultAgentsFor` (`defaultAgents.ts:81`) stops setting `cwd` at all and lets
  the store scope each seeded agent.
- `seedIfEmpty` (`seed.ts:83`) creates `workspaceDir()` and `worktreesDir()`.
  `worktreesDir()` is currently never created, so the first plan on a fresh
  install writes into a directory that does not exist.

`Agent.cwd` in `shared/types.ts` stays required — it is always resolved by the
time anything reads it. Only the *input* is optional.

### Existing installs

Agents already on disk name their `cwd` explicitly in `agent.toml`, so nothing
breaks. But an existing roster has every agent pointing at the shared
`~/roster/workspace`, which is the bug.

A one-time repair on `AgentStore.load()`, in two cases:

- The shared directory is **empty** → re-point every agent at its own
  `agentWorkspaceDir(id)`. Nothing can be lost, because there is nothing there.
  (On the live install it is empty, which is the common case — agents pointed at
  real repos never touched it.)
- The shared directory **has files** → change nothing, and surface a note on the
  agent's detail screen offering to scope it. Three agents' work mixed in one
  folder cannot be split correctly by a machine, and guessing would destroy work.

Naturally idempotent: after re-pointing, no agent's `cwd` matches the shared
default, so the repair never fires twice.

### UI

`WorkingDirectory` in `NewAgent` currently shows `~/roster/workspace`
(`NewAgent.tsx:113`) as placeholder text. It should say what leaving it unset
actually means now — a private folder for this agent — and what setting it means:
the project it will work on. `shared/ipc.ts:342` ("Defaults to ~/roster/workspace
when omitted") needs the same correction.

**Tests:** `agentWorkspaceDir` honours `ROSTER_HOME`; `create` with no `cwd`
scopes to the id and creates the directory; two agents with the same name get
different directories; an explicit `cwd` is untouched; rename leaves `cwd` alone;
the repair re-points when the shared dir is empty, does nothing when it has
files, and does nothing on a second load.

---

## Bug 2 — skills are never registered as skills

`SessionManager.skillPathsFor` (`sessions/manager.ts:976`) resolves the agent's
enabled skills to absolute paths, and `ClaudeRunner.run` passes them as
`additionalDirectories` (`runners/claude.ts:93`) — which only grants filesystem
**read** access to those folders.

The Agent SDK's actual switch is the `skills` option
(`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2037`), and skills are
discovered from setting sources or from plugins. Roster passes
`settingSources: []` (`claude.ts:70`), deliberately, so the user's own
`~/.claude/skills` is not loaded — but that also means *nothing* is discovered.

An agent with three skills enabled has three readable directories and zero
invocable skills. This is independent of `cwd`; it is broken in
`~/roster/workspace` too.

### The fix

`~/roster/skills/<name>/SKILL.md` is already exactly the layout a local Claude
Code plugin uses for its skills. The only thing missing is a manifest.

1. Write `~/roster/.claude-plugin/plugin.json` — idempotently, from `seedIfEmpty`
   and on every `SkillStore.load()`, so an existing install gets it on next launch.
2. In `ClaudeRunner.run`, replace the `additionalDirectories` line with:

```ts
plugins: [{ type: 'local', path: rosterHome(), skipMcpDiscovery: true }],
skills: options.skillNames,
```

`skipMcpDiscovery: true` because Roster owns this agent's MCP connections and a
manifest must not be able to add more.

3. `StartOptions` gains `skillNames: string[]` — the enabled skill names, which
   is what the `skills` filter matches. Keep `skillPaths`: it is what Codex needs
   in Bug 3, and read access to a linked skill's real location is still worth
   granting.

Because the plugin path is `rosterHome()` and not the cwd, an agent gets its
skills identically whether it is in its own `~/roster/workspace/tech-lead` or in
`~/work/api`. That is the "global roster files from any working dir"
requirement, discharged directly.

**Tests:** the SDK is handed the plugin entry and the agent's skill names; an
agent with no skills is handed neither; the manifest is written once and a
manifest the user has edited is not overwritten.

---

## Bug 3 — the skills would still not load, and Codex gets none

### 3a. No frontmatter

Both the five seeded skills (`store/seed.ts`) and `starterSkill()`
(`store/skills.ts:292`) begin at `# Title`. A skill needs YAML frontmatter with
`name` and `description`; without it the file is not a skill even once discovery
works. Confirmed against the live install — every `~/roster/skills/*/SKILL.md`
starts with a heading.

So Bug 2's fix alone would still surface nothing.

Going forward, `starterSkill()` and each `SEED_SKILLS` entry emit:

```markdown
---
name: repro-harness
description: Turn a bug report into a minimal failing test before touching source.
---
```

`description` comes from the one-line summary each already has under its title.

For skills already on disk, a one-time repair in `SkillStore.load()`: a SKILL.md
with no frontmatter gets one prepended, `name` from the directory and
`description` from the first prose line. Additive, never overwrites, and it
leaves the file correct in any Claude context — the user's own Claude Code
included, not only Roster.

Skipped for **linked** skills (`Skill.linkedFrom`): those live in a repo the user
maintains, and Roster writing into someone else's checkout is not its call. A
linked skill missing frontmatter is reported in the Skills screen instead.

> The alternative was a staging copy per session with frontmatter injected,
> touching no user file. Rejected: it breaks the identity between what Roster's
> editor edits and what the runner loads, and the symlink case makes that worse.

### 3b. Codex agents get no skills at all

`CodexRunner.run` ignores `options.skillPaths` entirely. `TODO.md:27` recorded
this next to the MCP gap; the MCP half was fixed by the stdio bridge, the skills
half was not.

Codex has no skill mechanism, so inline them: `composePrompt` (`codex.ts:218`)
gains the text of each enabled skill under a labelled block, framed the way
`sessions/projectBrief.ts` frames project context so the model does not read it
as the user talking.

Bounded by a character budget, for the same reason as `PROJECT_BRIEF_BUDGET` —
every turn pays for it. Over budget, skills are included whole in order and the
remainder are named but not inlined: half a skill is worse than a pointer to one.

**Tests:** a bare SKILL.md gains frontmatter with its body untouched; one that
already has frontmatter is byte-identical; a linked skill is never written to;
enabled skills appear in the Codex prompt and disabled ones do not; the budget
truncates by whole skills.

---

## Feature — export and share an agent

The one addition rather than a fix, and separable from everything above. It
depends only on Bug 1's path work.

### What is shareable

An `agent.toml` alone does not travel. `cwd` is a path on your machine,
`default_project` is a local id, and `skills`/`mcp_servers` are names that mean
nothing on a machine that lacks them.

So the export is one file — `<agent-name>.roster.toml`:

```toml
# Roster agent bundle, v1
[agent]
name = "Reviewer"
runner = "claude"
model = "claude-sonnet-5"
system_prompt = "..."

[[skill]]
name = "pr-review"
body = """<the full SKILL.md>"""

[[mcp_server]]
name = "linear"
command = "npx @modelcontextprotocol/server-linear"
env_keys = ["LINEAR_API_KEY"]   # names only — never values
```

Omitted by construction: `cwd`, `default_project`, `hidden`, and every MCP env
**value**.

### Why env values are omitted, not optional

`~/roster/mcp.json` stores server environments in the clear — `README.md:277`
says so. An export carrying them would turn "share my agent" into posting your
Linear token in Slack, and the person sharing would have no reason to expect it.
The key *names* travel so the recipient knows what to supply.

### Import

`agents.import(bundle)`, as one transaction:

- creates the agent with **no `cwd`**, so Bug 1's default gives it a scoped
  workspace on the importing machine, overridable in the import dialog;
- writes any skill not already in the library, suffixing a clashing name the way
  `SkillStore.create` already does rather than overwriting;
- adds MCP servers not already in `mcp.json`, with empty env;
- returns a summary the dialog shows: created, reused, and which servers still
  need secrets before the agent can run.

### Boundary

A bundle is untrusted input, handled like `store/agentToml.ts` and
`store/setupState.ts` handle theirs — parsed and validated field by field, with
failures naming the field. Two specific rules:

- **Skill names are path segments.** Reject any name that is not a plain slug; a
  bundle naming `../../.ssh` must not write there. Reuse `SkillStore.confine`.
- **`command` is never run on import.** It is written to `mcp.json` and launched
  only when the user later starts a session — the same gate a hand-added server
  passes through.

### Surface

- `AgentDetail` gains **Export…** → native save dialog.
- `ManageAgentsModal` gains **Import agent…** → native open dialog, then a
  confirmation listing what will be created and what is missing.
- Two IPC channels, `agentsExport` and `agentsImport`, on the existing bridge.

**Tests:** export → import reproduces the agent with a scoped `cwd`; env values
never appear in exported text; a traversing skill name is rejected; a clashing
skill name creates a suffixed skill and leaves the original alone; a malformed
bundle names the bad field.

---

## Order and risk

Bugs 2 and 3 are one change and land together: 2 without 3 surfaces nothing, 3
without 2 is dead weight. Bug 1 is independent and can go first. The export
feature depends only on Bug 1 and can go last or be dropped.

Nothing migrates or moves user data. Three writes touch existing user files, all
additive and all skippable by an older Roster, so a downgrade is safe:

| Write | When | Guard |
|---|---|---|
| `cwd` re-pointed in `agent.toml` | shared workspace is empty | skipped entirely if it has files |
| frontmatter prepended to `SKILL.md` | frontmatter absent | never for linked skills |
| `~/roster/.claude-plugin/plugin.json` | absent | never overwritten |

Coverage thresholds in `vitest.config.ts` (80/80/70/80) apply; `npm run check` is
the gate, and it is what CI runs on the PR.

## Follow-up

`TODO.md:32` is superseded by this document and should be rewritten to point at
it — the `~/.roster` requirement it records has been withdrawn.
