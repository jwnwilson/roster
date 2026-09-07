# ADR 0003: Board drops prioritize pointer containment

## Status

Accepted — 2026-09-07

## Context

The task board registers columns and their cards as droppable targets. It had
used dnd-kit's `closestCorners` strategy for every drag. With neighbouring
columns and cards, the nearest corner can differ from the area beneath the
pointer, making a visible target such as In Review difficult to enter.

## Decision

For pointer drags, use dnd-kit's `pointerWithin` collision strategy first.
When the pointer is not within a droppable target, fall back to
`closestCorners`. The fallback preserves target resolution for keyboard drags,
which have no pointer coordinates, and for gaps between targets.

## Consequences

* A column responds as soon as the pointer enters its visible drop area.
* Cards remain valid drop targets and continue to resolve to their column.
* Keyboard drag-and-drop retains the existing corner-based navigation
  behaviour.
