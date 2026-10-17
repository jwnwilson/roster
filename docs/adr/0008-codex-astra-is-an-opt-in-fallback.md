# ADR 0008: Codex Astra is an opt-in fallback

## Status

Accepted — 2026-10-04

## Context

Roster bundles Codex CLI so a fresh installation can run Codex agents. The
bundled 0.149.0 release predates the current CLI, and the fallback model picker
does not offer GPT-6 Astra when Codex's local model cache is unavailable.

GPT-6 Astra is available as `gpt-6-astra`, has a 1,050,000-token context
window, and its standard API-equivalent text rates are $10/M input, $1/M cached
input, and $50/M output.

## Decision

Update the bundled Codex SDK and CLI to 0.160.0. Include `gpt-6-astra` in the
offline fallback model list, its context-window table, and the versioned spend
estimate table. Roster continues to run the user's `codex` executable rather
than its bundled dependency, so Roster must not silently update the global
installation; the user updates that CLI through its normal updater.

Do not make Astra the seeded Codex default. Existing rosters keep their model
selection, and new Codex agents keep the lower-cost `gpt-5.6-terra` default;
users opt into Astra in the model picker.

Treat Codex's cached catalogue as the ordered, account-specific source for new
models. Append the offline fallback choices that the cache omits, so a cache
that has not refreshed after a CLI update cannot hide a supported model such
as Astra. Duplicate slugs are removed.

## Consequences

* Newly released models from Codex appear in the cache's own order. Astra and
  other offline choices remain selectable while that cache catches up.
* Its context meter and API-equivalent estimate are meaningful rather than
  unknown.
* The estimate does not attempt to apply long-context, regional-processing, or
  non-token tool charges because the Codex CLI stream does not establish them.
