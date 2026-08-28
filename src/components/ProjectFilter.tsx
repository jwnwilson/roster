import { Select } from '@/components/primitives'
import { ALL_PROJECTS, useRoster } from '@/state/store'

/**
 * The project filter, shared by the board and the grid.
 *
 * One component and one piece of state, deliberately. Two copies of this
 * control drifted once already — same look, separate filters, so picking a
 * project on the board left the grid showing everything.
 */
export function ProjectFilter() {
  const projects = useRoster((s) => s.projects)
  const value = useRoster((s) => s.projectFilter)
  const onChange = useRoster((s) => s.setProjectFilter)

  return (
    <Select
      ariaLabel="Filter by project"
      value={value}
      onChange={onChange}
      options={[
        { value: ALL_PROJECTS, label: 'All projects' },
        ...projects.map((project) => ({ value: project.id, label: project.name })),
      ]}
    />
  )
}
