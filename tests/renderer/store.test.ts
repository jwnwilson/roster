import { beforeEach, describe, expect, test } from 'vitest'
import {
  useRoster,
  selectGridAgents,
  selectSidebarAgents,
  selectVisibleAgents,
  selectCurrentAgent,
  activeProjects,
  archivedProjects,
  archivedProjectIds,
  projectById,
  projectPickerProjects,
  projectOptionLabel,
  sessionsInProject,
  ALL_PROJECTS,
} from '@/state/store'
import { anAgent, aProject, aSession } from './factories'

const INITIAL = useRoster.getState()

beforeEach(() => {
  useRoster.setState(INITIAL, true)
})

const AGENTS = [
  anAgent({ id: 'architect', name: 'Architect Agent' }),
  anAgent({ id: 'debugging', name: 'Debugging Agent' }),
  anAgent({ id: 'review', name: 'Review Agent' }),
]

describe('navigation', () => {
  test('opening an agent switches screen and remembers which agent', () => {
    useRoster.getState().openAgent('debugging')

    expect(useRoster.getState().screen).toBe('agent')
    expect(useRoster.getState().agentId).toBe('debugging')
  })

  test('opening a specific session records it for that agent', () => {
    useRoster.getState().openAgent('debugging', 'session-9')

    expect(useRoster.getState().sess['debugging']).toBe('session-9')
  })

  test('each agent keeps its own selected session across switches', () => {
    const { openAgent } = useRoster.getState()
    openAgent('debugging', 'debug-2')
    openAgent('review', 'review-1')
    openAgent('debugging')

    // Returning to an agent must not lose which session was being viewed.
    expect(useRoster.getState().sess['debugging']).toBe('debug-2')
    expect(useRoster.getState().sess['review']).toBe('review-1')
  })

  test('opening an agent without a session leaves the previous one intact', () => {
    useRoster.getState().openAgent('debugging', 'debug-2')
    useRoster.getState().openAgent('debugging')

    expect(useRoster.getState().sess['debugging']).toBe('debug-2')
  })
})

describe('filtering', () => {
  beforeEach(() => {
    useRoster.setState({ agents: AGENTS })
  })

  test('the sidebar matches on agent name, case-insensitively', () => {
    useRoster.setState({ query: 'REVIEW' })

    expect(selectSidebarAgents(useRoster.getState()).map((a) => a.id)).toEqual(['review'])
  })

  test('an empty sidebar query returns every agent by reference', () => {
    const state = useRoster.getState()
    // Reference equality matters: a fresh array here re-renders forever.
    expect(selectSidebarAgents(state)).toBe(state.agents)
  })

  test('whitespace-only queries are treated as empty', () => {
    useRoster.setState({ query: '   ' })
    expect(selectSidebarAgents(useRoster.getState())).toHaveLength(3)
  })

  test('the grid also matches on session titles', () => {
    useRoster.setState({
      gridQuery: 'leak',
      sessions: { review: [aSession({ agentId: 'review', title: 'Session leak on 504' })] },
    })

    expect(selectGridAgents(useRoster.getState()).map((a) => a.id)).toEqual(['review'])
  })

  test('the grid returns nothing when neither name nor session matches', () => {
    useRoster.setState({ gridQuery: 'nonexistent' })
    expect(selectGridAgents(useRoster.getState())).toEqual([])
  })
})

describe('hidden agents', () => {
  beforeEach(() => {
    useRoster.setState({
      agents: [...AGENTS.slice(0, 2), anAgent({ id: 'review', name: 'Review Agent', hidden: true })],
    })
  })

  test('omits hidden agents from the sidebar roster', () => {
    expect(selectSidebarAgents(useRoster.getState()).map((a) => a.id)).toEqual([
      'architect',
      'debugging',
    ])
  })

  test('omits hidden agents from the grid', () => {
    expect(selectGridAgents(useRoster.getState()).map((a) => a.id)).toEqual([
      'architect',
      'debugging',
    ])
  })

  test('a hidden agent cannot be surfaced by searching for it', () => {
    useRoster.setState({ query: 'Review', gridQuery: 'Review' })

    expect(selectSidebarAgents(useRoster.getState())).toEqual([])
    expect(selectGridAgents(useRoster.getState())).toEqual([])
  })

  test('keeps hidden agents available to assign, since hiding is only a view', () => {
    // Task assignees, the handoff tool and the Skills/MCP screens all read
    // state.agents directly. Hiding must not reach them.
    expect(useRoster.getState().agents.map((a) => a.id)).toContain('review')
  })

  test('selectVisibleAgents returns the roster itself when nothing is hidden', () => {
    useRoster.setState({ agents: AGENTS })
    const state = useRoster.getState()

    // Reference equality matters: a fresh array here re-renders forever.
    expect(selectVisibleAgents(state)).toBe(state.agents)
  })

  test('selectVisibleAgents drops the hidden ones', () => {
    expect(selectVisibleAgents(useRoster.getState()).map((a) => a.id)).toEqual([
      'architect',
      'debugging',
    ])
  })
})

describe('selectCurrentAgent', () => {
  test('returns null when no agent is open', () => {
    useRoster.setState({ agents: AGENTS })
    expect(selectCurrentAgent(useRoster.getState())).toBeNull()
  })

  test('returns null when the open agent has disappeared from disk', () => {
    useRoster.setState({ agents: AGENTS, agentId: 'deleted-agent' })
    expect(selectCurrentAgent(useRoster.getState())).toBeNull()
  })
})

describe('edit draft', () => {
  beforeEach(() => {
    useRoster.setState({
      agents: [
        anAgent({
          id: 'debugging',
          model: 'claude-opus-5',
          skills: ['repro-harness', 'stack-triage'],
          mcpServers: ['filesystem'],
        }),
      ],
      agentId: 'debugging',
    })
  })

  test('opening snapshots the agent config into the draft', () => {
    useRoster.getState().openEdit()

    expect(useRoster.getState().draft).toEqual({
      runner: 'claude',
      model: 'claude-opus-5',
      systemPrompt: 'Reproduce before you fix.',
      skills: { 'repro-harness': true, 'stack-triage': true },
      mcp: { filesystem: true },
      cwd: '/Users/test/work/api',
      cwdLabel: '~/work/api',
    })
  })

  test('editing the draft does not touch the agent', () => {
    useRoster.getState().openEdit()
    useRoster.getState().patchDraft({ model: 'claude-haiku-4-5' })

    expect(useRoster.getState().draft?.model).toBe('claude-haiku-4-5')
    expect(useRoster.getState().agents[0]?.model).toBe('claude-opus-5')
  })

  test('toggling a skill flips only that skill', () => {
    useRoster.getState().openEdit()
    useRoster.getState().toggleDraftSkill('stack-triage')

    expect(useRoster.getState().draft?.skills).toEqual({
      'repro-harness': true,
      'stack-triage': false,
    })
  })

  test('toggling a skill the agent does not have turns it on', () => {
    useRoster.getState().openEdit()
    useRoster.getState().toggleDraftSkill('adr-writer')

    expect(useRoster.getState().draft?.skills['adr-writer']).toBe(true)
  })

  test('cancelling discards the draft entirely', () => {
    useRoster.getState().openEdit()
    useRoster.getState().patchDraft({ model: 'changed' })
    useRoster.getState().cancelEdit()

    expect(useRoster.getState().editOpen).toBe(false)
    expect(useRoster.getState().draft).toBeNull()
  })

  test('opening for a missing agent does not open the modal', () => {
    useRoster.setState({ agentId: 'ghost' })
    useRoster.getState().openEdit()

    expect(useRoster.getState().editOpen).toBe(false)
  })
})

describe('tool expansion', () => {
  test('each tool call expands independently', () => {
    useRoster.getState().toggleTool('t1')

    expect(useRoster.getState().openTools['t1']).toBe(true)
    expect(useRoster.getState().openTools['t2']).toBeUndefined()
  })

  test('toggling twice collapses again', () => {
    useRoster.getState().toggleTool('t1')
    useRoster.getState().toggleTool('t1')

    expect(useRoster.getState().openTools['t1']).toBe(false)
  })
})

describe('active and archived projects', () => {
  const ACTIVE = aProject({ id: 'p1', name: 'API reliability' })
  const PUT_AWAY = aProject({ id: 'p2', name: 'Q3 planning', archivedAt: 1_700_000_500_000 })

  beforeEach(() => {
    useRoster.setState({ projects: [ACTIVE, PUT_AWAY] })
  })

  test('activeProjects leaves out the archived ones', () => {
    expect(activeProjects(useRoster.getState()).map((p) => p.id)).toEqual(['p1'])
  })

  test('archivedProjects keeps only those', () => {
    expect(archivedProjects(useRoster.getState()).map((p) => p.id)).toEqual(['p2'])
  })

  test('archivedProjectIds is the set of ids to hide work for', () => {
    const ids = archivedProjectIds(useRoster.getState())

    expect(ids.has('p2')).toBe(true)
    expect(ids.has('p1')).toBe(false)
  })

  test('projectById still resolves an archived project', () => {
    // Spend and every task card name a project by id; an archived one that
    // stopped resolving would make old work read as unfiled.
    expect(projectById(useRoster.getState(), 'p2')?.name).toBe('Q3 planning')
  })
})

describe('projectPickerProjects', () => {
  const ACTIVE = aProject({ id: 'p1', name: 'API reliability' })
  const PUT_AWAY = aProject({ id: 'p2', name: 'Q3 planning', archivedAt: 1_700_000_500_000 })

  beforeEach(() => {
    useRoster.setState({ projects: [ACTIVE, PUT_AWAY] })
  })

  test('offers the active projects', () => {
    expect(projectPickerProjects(useRoster.getState(), null).map((p) => p.id)).toEqual(['p1'])
  })

  test('keeps the current value even when it is archived', () => {
    // Select is a native <select>: a value with no matching option renders
    // blank, so a task filed under an archived project would look unfiled.
    expect(projectPickerProjects(useRoster.getState(), 'p2').map((p) => p.id)).toEqual([
      'p1',
      'p2',
    ])
  })

  test('says which one is archived', () => {
    expect(projectOptionLabel(PUT_AWAY)).toBe('Q3 planning (archived)')
    expect(projectOptionLabel(ACTIVE)).toBe('API reliability')
  })

  test('does not list an active current value twice', () => {
    expect(projectPickerProjects(useRoster.getState(), 'p1').map((p) => p.id)).toEqual(['p1'])
  })

  test('ignores a current value that no longer exists', () => {
    expect(projectPickerProjects(useRoster.getState(), 'gone').map((p) => p.id)).toEqual(['p1'])
  })

  test('hands back the store’s own objects, so useShallow can compare them', () => {
    const state = useRoster.getState()
    // Freshly built option records here would re-render forever.
    expect(projectPickerProjects(state, null)[0]).toBe(state.projects[0])
  })
})

describe('archiving a project takes its sessions off the grid', () => {
  const ACTIVE = aProject({ id: 'p1' })
  const PUT_AWAY = aProject({ id: 'p2', archivedAt: 1_700_000_500_000 })

  beforeEach(() => {
    useRoster.setState({
      agents: AGENTS,
      projects: [ACTIVE, PUT_AWAY],
      sessions: {
        architect: [aSession({ agentId: 'architect', projectId: 'p1' })],
        debugging: [aSession({ agentId: 'debugging', projectId: 'p2' })],
        review: [aSession({ agentId: 'review', projectId: null })],
      },
    })
  })

  test('sessionsInProject drops the ones whose project is archived', () => {
    const state = useRoster.getState()
    const sessions = state.sessions['debugging'] ?? []

    expect(sessionsInProject(sessions, ALL_PROJECTS, archivedProjectIds(state))).toEqual([])
  })

  test('an agent whose only work is archived leaves the grid', () => {
    expect(selectGridAgents(useRoster.getState()).map((a) => a.id)).toEqual([
      'architect',
      'review',
    ])
  })

  test('restoring the project brings the agent back', () => {
    useRoster.setState({ projects: [ACTIVE, { ...PUT_AWAY, archivedAt: null }] })

    expect(selectGridAgents(useRoster.getState()).map((a) => a.id)).toEqual([
      'architect',
      'debugging',
      'review',
    ])
  })

  test('with no archived projects, sessionsInProject is unchanged', () => {
    const sessions = useRoster.getState().sessions['debugging'] ?? []

    expect(sessionsInProject(sessions, ALL_PROJECTS)).toBe(sessions)
  })
})
