import type { Agent, TaskPriority, TaskStatus } from '../../../shared/types'
import { PROJECT_COLORS } from '../../../shared/tasks'
import type { ProjectStore } from './projects'
import type { TaskStore } from './tasks'

/**
 * First-run content for the task board.
 *
 * The filesystem seed in ./seed.ts runs before the database is open, so the
 * board cannot go there. Same contract though: only ever writes into an empty
 * board, and never touches anything a user has already made.
 */

interface SeedTask {
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  /** The seeded agent's id, or null when nobody has picked it up. */
  assignee: string | null
  project: string
  labels: string[]
  comments?: { author: string; tone: 'you' | 'agent'; text: string }[]
}

const PROJECTS = [
  {
    key: 'migration',
    name: 'Multi-region migration',
    color: PROJECT_COLORS[0] as string,
    description: 'Move session storage to a token-replay model across regions.',
  },
  {
    key: 'reliability',
    name: 'API reliability',
    color: PROJECT_COLORS[4] as string,
    description: 'Close out connection-handling bugs and flaky tests in the API layer.',
  },
  {
    key: 'planning',
    name: 'Q3 planning',
    color: PROJECT_COLORS[3] as string,
    description: 'Break the roadmap into estimable, owned tasks.',
  },
]

const TASKS: SeedTask[] = [
  {
    title: 'Add concurrent index for sessions.region migration',
    description:
      'The dry run showed a ~4s lock building the index on `sessions.region` at staging volume. Production needs a concurrent index build instead of the default migration.',
    status: 'todo',
    priority: 'medium',
    assignee: null,
    project: 'migration',
    labels: ['migration', 'db'],
  },
  {
    title: 'Investigate flaky auth test',
    description:
      '`tests/test_auth.py::test_refresh_window` fails about 1 in 20 CI runs. The refresh window is compared against wall clock — likely a second-boundary race.',
    status: 'todo',
    priority: 'high',
    assignee: null,
    project: 'reliability',
    labels: ['bug', 'tests'],
  },
  {
    title: 'Write ADR template for cross-region failover',
    description: 'Standardise the ADR format so failover designs are comparable across services.',
    status: 'todo',
    priority: 'low',
    assignee: 'architect',
    project: 'migration',
    labels: ['docs'],
  },
  {
    title: 'Migration dry-run against staging copy',
    description:
      'Run the 014 migration against a copy of staging and report row counts before and after, plus lock duration.',
    status: 'in_progress',
    priority: 'medium',
    assignee: 'debugging',
    project: 'migration',
    labels: ['migration'],
    comments: [
      {
        author: 'Debugging Agent',
        tone: 'agent',
        text: 'Dry run is clean. Index build locks sessions for about 4s at staging volume — wants a concurrent index in prod. Still counting rows.',
      },
    ],
  },
  {
    title: 'Break Q3 roadmap into estimable tasks',
    description:
      'Split the Q3 roadmap into day-or-less tasks. Flag unowned tasks and cross-team dependencies explicitly.',
    status: 'in_progress',
    priority: 'medium',
    assignee: 'estimation',
    project: 'planning',
    labels: ['planning'],
    comments: [
      {
        author: 'Estimation Agent',
        tone: 'agent',
        text: 'Six epics, 41 tasks so far. Three tasks have no owner and two depend on the multi-region work landing first.',
      },
    ],
  },
  {
    title: 'Fix connection pool leak on 504',
    description:
      'Pool never releases the connection when the upstream returns 504. Add a `try`/`finally` around the handler and a regression test.',
    status: 'in_review',
    priority: 'urgent',
    assignee: 'debugging',
    project: 'reliability',
    labels: ['bug', 'api'],
    comments: [
      {
        author: 'You',
        tone: 'you',
        text: 'Reproduces about every 90s under sustained 504s — please prioritise.',
      },
      {
        author: 'Debugging Agent',
        tone: 'agent',
        text: 'Patch on fix/session-leak: try/finally plus the regression test. Moved to review — waiting on approval to force-push.',
      },
    ],
  },
  {
    title: 'Style pass on api/ handlers',
    description: 'Read through `api/` and note where handlers drift from house style.',
    status: 'in_review',
    priority: 'low',
    assignee: 'review',
    project: 'reliability',
    labels: ['style'],
    comments: [
      {
        author: 'Review Agent',
        tone: 'agent',
        text: 'Mostly consistent. Exceptions: three handlers return dicts instead of models, and logger names in api/routes are inconsistent.',
      },
    ],
  },
  {
    title: 'ADR-014: multi-region session store',
    description:
      'Document the sticky-session vs. token-replay comparison and the decision to use token replay.',
    status: 'in_review',
    priority: 'high',
    assignee: 'architect',
    project: 'migration',
    labels: ['docs', 'architecture'],
    comments: [
      {
        author: 'Architect Agent',
        tone: 'agent',
        text: 'Replay wins — no cross-region affinity, and failover becomes a routing change rather than a data migration. Draft is up for review.',
      },
    ],
  },
  {
    title: 'Review PR #482 — pool release fix',
    description: 'Review `fix/session-leak`, 3 files +81 −22. Focus on the error paths.',
    status: 'done',
    priority: 'high',
    assignee: 'review',
    project: 'reliability',
    labels: ['bug'],
    comments: [
      {
        author: 'Review Agent',
        tone: 'agent',
        text: 'Two blocking notes and one nit, both addressed. Approved.',
      },
    ],
  },
  {
    title: 'Freeze fixture clock for refresh window test',
    description:
      '`test_refresh_window` compares against wall clock — freeze it in the fixture so second-boundary crossings stop flipping the assertion.',
    status: 'done',
    priority: 'medium',
    assignee: 'debugging',
    project: 'reliability',
    labels: ['tests'],
    comments: [
      {
        author: 'Debugging Agent',
        tone: 'agent',
        text: 'Froze the clock in the fixture. Reran 200x locally with no failures.',
      },
    ],
  },
]

/**
 * Seeds the board, but only when it is completely empty.
 *
 * Tasks are created through the store rather than inserted directly, so the
 * key counter advances with them — otherwise the first task a user made would
 * collide with a seeded one.
 */
export function seedBoardIfEmpty(
  projects: ProjectStore,
  tasks: TaskStore,
  agents: readonly Agent[],
): boolean {
  if (projects.findAll().length > 0 || tasks.findAll().length > 0) return false

  const known = new Set(agents.map((agent) => agent.id))
  const ids = new Map<string, string>()

  for (const project of PROJECTS) {
    const created = projects.create({
      name: project.name,
      color: project.color,
      description: project.description,
    })
    ids.set(project.key, created.id)
  }

  for (const seed of TASKS) {
    // A demo assignee only makes sense if that agent actually exists — the
    // user may have seeded a roster of their own, or removed one.
    const assigneeId = seed.assignee !== null && known.has(seed.assignee) ? seed.assignee : null

    const task = tasks.create({
      title: seed.title,
      description: seed.description,
      status: seed.status,
      priority: seed.priority,
      assigneeId,
      projectId: ids.get(seed.project) ?? null,
      labels: seed.labels,
    })

    for (const comment of seed.comments ?? []) {
      tasks.comment(task.id, comment)
    }
  }

  return true
}
