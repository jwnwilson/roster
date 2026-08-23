import { vi } from 'vitest'
import type { RosterApi } from '@shared/ipc'

/**
 * A stub for the preload bridge. Component tests exercise the renderer, not
 * IPC, so every call resolves empty unless a test overrides it.
 */
export function installRosterApi(overrides: DeepPartial<RosterApi> = {}): RosterApi {
  const api: RosterApi = {
    window: { minimize: vi.fn(), maximize: vi.fn(), close: vi.fn() },
    runners: {
      list: vi.fn().mockResolvedValue([]),
      models: vi.fn().mockResolvedValue([]),
    },
    agents: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(null),
      onChanged: vi.fn().mockReturnValue(() => {}),
    },
    sessions: {
      listByAgent: vi.fn().mockResolvedValue([]),
      recentByAgent: vi.fn().mockResolvedValue({}),
      listAll: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue(null),
      messages: vi.fn().mockResolvedValue([]),
      usage: vi.fn().mockResolvedValue(null),
      send: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      respondToApproval: vi.fn().mockResolvedValue(undefined),
      pendingApprovals: vi.fn().mockResolvedValue([]),
      onEvent: vi.fn().mockReturnValue(() => {}),
    },
    pty: {
      open: vi.fn().mockResolvedValue({ shell: 'zsh', cwd: '/work' }),
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      onData: vi.fn().mockReturnValue(() => {}),
      onExit: vi.fn().mockReturnValue(() => {}),
    },
    skills: {
      list: vi.fn().mockResolvedValue([]),
      read: vi.fn().mockResolvedValue(''),
      write: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(null),
      createFile: vi.fn().mockResolvedValue('/skills/x/new.md'),
      createFolder: vi.fn().mockResolvedValue('/skills/x/new'),
      reveal: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(true),
      removeSkill: vi.fn().mockResolvedValue(true),
    },
    mcp: {
      list: vi.fn().mockResolvedValue([]),
      setEnabled: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue([]),
    },
    dialog: {
      chooseDirectory: vi.fn().mockResolvedValue(null),
    },
  }

  const merged = mergeDeep(
    api as unknown as Record<string, unknown>,
    overrides as Record<string, unknown>,
  ) as RosterApi
  ;(window as unknown as { roster: RosterApi }).roster = merged
  return merged
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

function mergeDeep(base: Record<string, unknown>, patch: Record<string, unknown>): unknown {
  const out: Record<string, unknown> = { ...base }

  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key]
    out[key] =
      isPlainObject(existing) && isPlainObject(value)
        ? mergeDeep(existing, value)
        : value
  }

  return out
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !vi.isMockFunction(value)
}
