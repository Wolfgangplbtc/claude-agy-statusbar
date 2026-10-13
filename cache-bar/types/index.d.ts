export type Limit = { percent: number; resetsAt?: string }

export type Snapshot = {
  contextPercent?: number
  contextTokens?: number
  contextWindow: number
  fiveHour?: Limit
  sevenDay?: Limit
  costUsd?: number
}

// Slow-changing facts about the session, refreshed at start and after each turn.
export type Info = {
  email?: string
  project: string
  branch?: string
  model?: string
  turns: number
  lastHandoffAt?: number
  // Context thresholds from Agent Hub settings (or the defaults).
  progi?: { handoff: number; advise: number }
}

// An automatic handoff waiting for its file in session-logs/.
export type AutoCycle = { startedAt: number; turnsWaited: number }

declare module 'claude-code' {
  interface PluginState {
    'cache-bar': {
      snapshot: Snapshot | null
      lastResponseAt: number | null
      now: number
      info: Info | null
      autoOn: boolean
      cycle: AutoCycle | null
    }
  }
}
