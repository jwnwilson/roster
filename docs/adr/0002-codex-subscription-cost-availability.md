# ADR 0002: Represent unavailable Codex subscription spend explicitly

## Status

Accepted — 2026-09-06

## Context

Roster records token usage from the Codex CLI's `turn.completed` JSON event.
That event supplies input, cached-input, and output token counts, but no
per-turn dollar charge. For a ChatGPT-authenticated Codex session, the
underlying account is a subscription rather than a token-metered API invoice.

The normalizer currently writes `costUsd: 0` for every Codex turn. Roster then
persists and aggregates that value, so the Spend screen renders `$0.00`. This
looks like a measured zero charge even though Roster has no charge data.

## Decision

Represent an unavailable cost separately from a zero dollar cost. For Codex
turns authenticated through ChatGPT, retain the reported token totals and show
the monetary value as unavailable/included in the subscription, rather than
`$0.00`.

Do not estimate a subscription's per-turn cost from public API token prices.
Those prices are for API billing, can change independently, and do not turn a
flat subscription into an actual per-token charge. API-key Codex billing is a
separate feature: it requires a versioned model-price source, cache-token
rates, and explicit disclosure that the number is an estimate unless a billed
amount is available from OpenAI.

## Consequences

* Token totals remain available for capacity and usage analysis.
* `$0.00` continues to mean an actual known zero, not a missing price.
* Spend aggregation and the renderer need a cost-availability state, plus
  migration behaviour for existing zero-valued Codex records.
* A future API-cost feature can be added without presenting its estimate as
  ChatGPT subscription spend.
