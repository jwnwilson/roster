import { Select } from '@/components/primitives'
import { ALL_PROJECTS, useRoster } from '@/state/store'

/**
 * The project filter, shared by the board, the grid and the backlog.
 *
 * One component and one piece of state, deliberately. Two copies of this
 * control drifted once already — same look, separate filters, so picking a
 * project on the board left the grid showing everything. The Backlog tab
 * puts two of them on screen at once, which makes a shared value the only
 * honest option.
 */
export function ProjectFilter({
  className,
  compact = false,
}: {
  className?: string
  compact?: boolean
}) {
  const projects = useRoster((s) => s.projects)
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
