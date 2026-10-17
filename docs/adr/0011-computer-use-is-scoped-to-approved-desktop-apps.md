# ADR 0011: Computer Use is scoped to approved desktop apps

## Status

Accepted — 2026-10-17

## Context

Some Roster agents need to complete work that is only available through a
laptop application's graphical interface. Giving an agent unrestricted control
of a laptop would expose unrelated applications, signed-in sessions, screen
content, and local data.

OpenAI's managed Computer Use plugin for the ChatGPT desktop app can operate
approved macOS and Windows applications. Operating-system permissions and app
approvals are separate controls. The feature can affect state outside the
project workspace, so each use needs a deliberately narrow boundary.

## Decision

Use the managed Computer Use plugin; do not build or operate a custom
desktop-control integration.

Every initial rollout is a supervised pilot with all of the following recorded
before it starts:

* one named agent;
* one named low-risk desktop application;
* a read-only or reversible task and observable success criteria; and
* a named laptop owner present to review permission prompts and sensitive
  actions.

Do not persist app access during a pilot: decline **Always allow**. Keep
credential, payment, submission, account/security/privacy, network-setting,
and sensitive-data flows under direct human control. The laptop owner may stop
or take over a task at any time.

After a successful pilot, a designated safety/release reviewer decides whether
to add one additional named app or make access persistent. Approval evidence
and the reviewer decision are required before widening access. Revocation
removes the app from Computer Use's allowed-app list and removes the macOS
Screen Recording and Accessibility permissions if Computer Use is no longer
needed.

## Consequences

* The first use is slower than unrestricted enablement, but has a testable
  blast radius and a clear rollback path.
* macOS use requires Screen Recording and Accessibility permissions. Windows
  use requires the target app to remain visible in the active desktop session.
* Computer Use does not replace existing Codex sandbox and approval controls
  for file edits and shell commands.
* The operational checklist lives in
  [`docs/runbooks/computer-use-pilot.md`](../runbooks/computer-use-pilot.md).

## References

* [OpenAI Computer Use documentation](https://learn.chatgpt.com/docs/computer-use)
