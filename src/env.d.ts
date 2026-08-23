/// <reference types="vite/client" />
import type { RosterApi } from '@shared/ipc'

declare global {
  interface Window {
    roster: RosterApi
  }
}
