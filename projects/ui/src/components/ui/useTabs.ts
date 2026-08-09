import { useId } from "react";

export interface TabsProps<T extends string> {
  tabs: readonly T[];
  active: T;
  onChange: (next: T) => void;
  label: string;
}

/** A tablist that keeps the promises its roles make.
 *
 * `role="tab"` without `aria-controls`, a matching `role="tabpanel"`, or
 * arrow-key movement announces "tab, 1 of 4" to a screen reader and then leads
 * nowhere. Roving tabindex means Tab enters the group once and arrows move
 * within it, which is the interaction the role implies.
 */
export function useTabs<T extends string>({ tabs, active, onChange, label }: TabsProps<T>) {
  const base = useId();
  const tabId = (name: T) => `${base}-tab-${name}`;
  const panelId = (name: T) => `${base}-panel-${name}`;

  const tablistProps = { role: "tablist" as const, "aria-label": label };

  const tabProps = (name: T) => ({
    id: tabId(name),
    role: "tab" as const,
    "aria-selected": active === name,
    "aria-controls": panelId(name),
    tabIndex: active === name ? 0 : -1,
    onClick: () => onChange(name),
    onKeyDown: (event: React.KeyboardEvent) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const next = tabs[(tabs.indexOf(active) + step + tabs.length) % tabs.length];
      onChange(next);
    },
  });

  const panelProps = (name: T) => ({
    id: panelId(name),
    role: "tabpanel" as const,
    "aria-labelledby": tabId(name),
  });

  return { tablistProps, tabProps, panelProps };
}
