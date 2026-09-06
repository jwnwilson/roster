# 0002 — Codex spend is an API-equivalent estimate

Date: 2026-09-06

## Status

Accepted. This supersedes the subscription-only presentation decision in PRs
#59 and #65.

## Decision

Roster records a cost type alongside every usage row:

- **actual** — a known, billed cost reported by a provider. It remains the
  provider's figure and is never recalculated by Roster.
- **estimated** — an API-equivalent estimate calculated from Codex's recorded
  model and token usage using the versioned rate table stored with the row.
  It is not an invoiced ChatGPT charge.
- **unavailable** — Roster cannot map the recorded Codex model to a rate. It
  has no dollar amount and is rendered as “Estimate unavailable”, never
  `$0.00`.

For a mapped Codex model, Roster calculates:

```
((inputTokens - cachedInputTokens) * inputRate
 + cachedInputTokens * cachedInputRate
 + outputTokens * outputRate) / 1_000_000
```

Missing cached input is zero. Codex's `output_tokens` already includes its
reasoning tokens, so reasoning is not added again.

The selected model and rate-table version are stored on the usage row. This
makes completed turns historically stable when the current table or an agent's
configured model changes. Existing Codex usage is backfilled when its agent's
recorded configuration can be mapped; otherwise it becomes unavailable.

Totals that include an estimate are explicitly labelled estimated. A total can
include both actual and estimated values, but it must not be represented as an
actual ChatGPT invoice.

## Consequences

Roster gives subscription users a useful, intentionally rough spend signal.
It does not claim parity with ChatGPT analytics, subscription entitlements, or
an API invoice, and it does not query ChatGPT's leaderboard.
