import { useId, useRef } from "react";
import type { KeyboardEvent } from "react";

export interface TabsProps<T extends string> {
  tabs: readonly T[];
  active: T;
  onChange: (next: T) => void;
  label: string;
}

/** A tablist that keeps the promises its roles make.
 *
 * `role="tab"` without `aria-controls`, a matching `role="tabpanel"`, or
 * arrow-key movement announces "tab, 1 of 4" and then leads nowhere.
 *
 * Arrow keys move **focus as well as selection**. Changing selection alone
 * leaves the user standing on a `tabindex="-1"` element that is no longer
 * selected: a screen reader never announces where they moved to, and the next
 * Tab exits the group with no way back. That is the roving-tabindex pattern
 * half-implemented, which is worse than not claiming it.
 */
export function useTabs<T extends string>({ tabs, active, onChange, label }: TabsProps<T>) {
  const base = useId();
  const refs = useRef(new Map<T, HTMLElement | null>());
  const tabId = (name: T) => `${base}-tab-${name}`;
  const panelId = (name: T) => `${base}-panel-${name}`;

  const tablistProps = { role: "tablist" as const, "aria-label": label };

  const move = (step: number) => {
    const next = tabs[(tabs.indexOf(active) + step + tabs.length) % tabs.length];
    onChange(next);
    // After the re-render that flips tabindex, not before it.
    requestAnimationFrame(() => refs.current.get(next)?.focus());
  };

  const tabProps = (name: T) => ({
    id: tabId(name),
    role: "tab" as const,
    "aria-selected": active === name,
    // Only the selected tab points at a panel: the others are not rendered, and
    // an aria-controls resolving to nothing is worse than none at all.
    ...(active === name ? { "aria-controls": panelId(name) } : {}),
    tabIndex: active === name ? 0 : -1,
    ref: (node: HTMLElement | null) => {
      refs.current.set(name, node);
    },
    onClick: () => onChange(name),
    onKeyDown: (event: KeyboardEvent) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      move(step);
    },
  });

  const panelProps = (name: T) => ({
    id: panelId(name),
    role: "tabpanel" as const,
    "aria-labelledby": tabId(name),
  });

  return { tablistProps, tabProps, panelProps };
}
