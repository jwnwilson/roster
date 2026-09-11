# ADR 0004: Codex rate table covers offered fallbacks

## Status

Accepted — 2026-09-11. This amends ADR 0002's rate-table maintenance policy.

## Context

ADR 0002 correctly introduced API-equivalent estimates, but its table covered
only older Codex model names. Roster's Codex fallback picker offered `gpt-5.5`
and other current choices that the table could not price, making normal usage
read as "Estimate unavailable".

## Decision

Every model in CodexRunner's static fallback list must have an explicit entry
in the versioned Codex rate table. Dated snapshots use the canonical model
family's explicit rate; the original snapshot slug remains stored on the usage
row. Models discovered dynamically from the Codex CLI are intentionally not
guessed: an unmapped one remains `unavailable` until a reviewed rate entry is
added.

This revision records the standard API-equivalent text-token rates published
on 2026-09-11. For `gpt-5.5`, that is $5.00/M input, $0.50/M cached input, and
$30.00/M output. The estimate retains ADR 0002's formula and label; it is not
a ChatGPT invoice.

Rows previously marked unavailable are retried at startup when their persisted
model is now covered. Their persisted model has precedence over an agent's
current model. Existing estimated rows are not recalculated, preserving
historical rate-table provenance.

## Consequences

* The normal fallback choices produce a labelled estimate instead of a false
  `$0.00` or unnecessary unavailable state.
* Unknown dynamically discovered models remain honest rather than inheriting a
  nearby model's price.
* Standard API rates omit pricing adjustments Roster cannot establish from the
  CLI stream, including GPT-5.5 long-context multipliers, regional processing
  uplifts, and any non-token tool charges. The UI continues to call the result
  an estimate.
