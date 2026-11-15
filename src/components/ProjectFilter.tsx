import { useShallow } from 'zustand/shallow'
import { Select } from '@/components/primitives'
import { ALL_PROJECTS, activeProjects, useRoster } from '@/state/store'

/**
 * The app-wide project filter. It is rendered once, at the top of the sidebar,
 * so it is on screen on every screen and every screen reads the same value.
 *
 * Not repeated in screen headers: two copies of this control drifted once
 * already — same look, separate filters, so picking a project on one screen
 * left another showing everything. One control, in one place, cannot drift.
 */
export function ProjectFilter({
  className,
  compact = false,
}: {
  className?: string
  compact?: boolean
}) {
  // Archived projects are not on offer. A filter left pointing at one is
  // reset by the store when the project list changes, so this cannot end
  // up showing a blank select.
  const projects = useRoster(useShallow(activeProjects))
  const value = useRoster((s) => s.projectFilter)
  const onChange = useRoster((s) => s.setProjectFilter)

  return (
    <Select
      ariaLabel="Filter by project"
      value={value}
      onChange={onChange}
      compact={compact}
      {...(className !== undefined ? { className } : {})}
      options={[
        { value: ALL_PROJECTS, label: 'All projects' },
        ...projects.map((project) => ({ value: project.id, label: project.name })),
      ]}
    />
  )
}
