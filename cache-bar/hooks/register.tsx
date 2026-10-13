import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, SessionUsage } from 'claude-code'

import type { AutoCycle, Info, Limit, Snapshot } from '../types'

// Claude Code on a subscription keeps the prompt cache for about an hour
// after the last request. Change this if your setup uses the 5-minute cache.
const CACHE_TTL_MS = 60 * 60 * 1000
// Below this many minutes left the cache shows as cooling down.
const CACHE_COOLING_MIN = 15
// Context thresholds, read from Agent Hub's settings when it is installed:
// PROG_PRZEKAZANIA (handoff required, automatic handoff; 0 = off) and
// PROG_OSTRZEZENIA (handoff advised), shared nadzor.conf first, then the
// project's own stan/nadzor/<project>/ustawienia.conf. Same keys the supervisor uses.
export type Progi = { handoff: number; advise: number }
export const DOMYSLNE_PROGI: Progi = { handoff: 35, advise: 25 }
// A handoff file newer than this counts as "just saved".
const FRESH_HANDOFF_MIN = 20
const HANDOFF_PROMPT =
  'Use the session-handoff skill and save a handoff of this session to a file: the goal, what we did, decisions, open issues and next steps, so a fresh session can continue from it.'
// Automatic handoff: past the handoff threshold the bar asks for a handoff by itself,
// waits for the new file in session-logs/, then runs /clear and pickup.
// Toggle with /handoff-auto (remembered across sessions).
const PICKUP_PROMPT = 'pickup'
// Give up when no handoff file shows up after this many model turns.
const MAX_WAIT_TURNS = 3
// Agent Hub reads one file per session from here to show handoff warnings.
const STATE_DIR = '.claude/stan-sesji'

const snapshot = atom({ plugin: 'cache-bar', key: 'snapshot' } as const, null)
const lastResponseAt = atom({ plugin: 'cache-bar', key: 'lastResponseAt' } as const, null)
const now = atom({ plugin: 'cache-bar', key: 'now' } as const, 0)
const info = atom({ plugin: 'cache-bar', key: 'info' } as const, null)
const autoOn = atom({ plugin: 'cache-bar', key: 'autoOn' } as const, true)
const cycle = atom({ plugin: 'cache-bar', key: 'cycle' } as const, null)

const pick = (limits: SessionRateLimit[], kind: string): Limit | undefined => {
  const one = limits.find(l => l.kind === kind)
  return one ? { percent: one.percentUsed, resetsAt: one.resetsAt } : undefined
}

const toSnapshot = (u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>): Snapshot => ({
  contextPercent: u.context.percent,
  contextTokens: u.context.tokens,
  contextWindow: u.context.window,
  fiveHour: pick(u.rateLimits, 'five_hour'),
  sevenDay: pick(u.rateLimits, 'seven_day'),
  costUsd: u.cost?.usd,
})

export const fmtTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

export const fmtDuration = (ms: number): string => {
  const min = Math.max(0, Math.round(ms / 60000))
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h${String(min % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

export const bar = (percent: number, width = 10): string => {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export type CacheState = { kind: 'unknown' | 'warm' | 'cooling' | 'cold'; leftMs: number }

export const cacheState = (last: number | null, at: number): CacheState => {
  if (last === null) return { kind: 'unknown', leftMs: 0 }
  const leftMs = CACHE_TTL_MS - (at - last)
  if (leftMs <= 0) return { kind: 'cold', leftMs: 0 }
  return { kind: leftMs < CACHE_COOLING_MIN * 60000 ? 'cooling' : 'warm', leftMs }
}

export type HandoffState = 'zapisano' | 'wymagany' | 'zalecany' | 'ok'

// Same order as the agy status line: a fresh handoff wins, then the context fill.
export const handoffState = (
  ctxPercent: number | undefined,
  minutesSince: number | undefined,
  progi: Progi = DOMYSLNE_PROGI,
): HandoffState => {
  if (minutesSince !== undefined && minutesSince < FRESH_HANDOFF_MIN) return 'zapisano'
  if (ctxPercent !== undefined && progi.handoff > 0 && ctxPercent >= progi.handoff) return 'wymagany'
  if (ctxPercent !== undefined && progi.advise > 0 && ctxPercent >= progi.advise) return 'zalecany'
  return 'ok'
}

export type AutoAction = 'start' | 'finish' | 'wait' | 'giveup' | 'none'

// One step of the automatic handoff, decided after each main-thread turn.
export const autoStep = (
  on: boolean,
  c: AutoCycle | null,
  ctxPercent: number | undefined,
  newestHandoffAt: number | undefined,
  now: number,
  progi: Progi = DOMYSLNE_PROGI,
): AutoAction => {
  if (c !== null) {
    if (newestHandoffAt !== undefined && newestHandoffAt > c.startedAt) return 'finish'
    return c.turnsWaited + 1 >= MAX_WAIT_TURNS ? 'giveup' : 'wait'
  }
  if (!on || progi.handoff <= 0 || ctxPercent === undefined || ctxPercent < progi.handoff) return 'none'
  // A handoff saved by hand a moment ago: leave the /clear to the person.
  if (newestHandoffAt !== undefined && now - newestHandoffAt < FRESH_HANDOFF_MIN * 60000) return 'none'
  return 'start'
}

const resetIn = (limit: Limit, at: number): string => {
  if (!limit.resetsAt) return ''
  const t = Date.parse(limit.resetsAt)
  return Number.isNaN(t) ? '' : ` (↻${fmtDuration(t - at)})`
}

// Reads the account, git branch, model, turn count and newest handoff file.
// KEY=number lines of a settings file (comments and anything else ignored).
export const czytajProgi = (texts: readonly string[], start: Progi = DOMYSLNE_PROGI): Progi => {
  const p = { ...start }
  for (const text of texts) {
    for (const line of text.split('\n')) {
      const m = /^\s*(PROG_PRZEKAZANIA|PROG_OSTRZEZENIA)="?(\d{1,3})"?\s*(#.*)?$/.exec(line)
      if (!m || m[2] === undefined) continue
      const v = Math.min(100, Number(m[2]))
      if (m[1] === 'PROG_PRZEKAZANIA') p.handoff = v
      else p.advise = v
    }
  }
  return p
}

async function readProgi($: EngineInterface, home: string | undefined, project: string): Promise<Progi> {
  const hub = (await $.env.get('AGENT_HUB_DIR')) || (home ? `${home}/agent-hub` : undefined)
  if (!hub) return DOMYSLNE_PROGI
  const texts: string[] = []
  for (const f of [`${hub}/nadzor.conf`, `${hub}/stan/nadzor/${project}/ustawienia.conf`]) {
    try {
      texts.push(await $.fs.read(f))
    } catch {
      // no file: keep what we have
    }
  }
  return czytajProgi(texts)
}

async function refreshInfo($: EngineInterface) {
  const cwd: string = await $.session.cwd()
  const home: string | undefined = await $.env.get('HOME')
  let email: string | undefined
  try {
    if (home) email = JSON.parse(await $.fs.read(`${home}/.claude.json`))?.oauthAccount?.emailAddress
  } catch {
    // no login file: the bar leaves the account out
  }
  let branch: string | undefined
  try {
    const r = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 3000 })
    if (r.exitCode === 0) branch = r.stdout.trim() || undefined
  } catch {
    // not a repository
  }
  let lastHandoffAt: number | undefined
  try {
    for (const f of await $.fs.list(`${cwd}/session-logs`)) {
      if (f.kind === 'file' && f.name.endsWith('.md') && (lastHandoffAt === undefined || f.mtimeMs > lastHandoffAt))
        lastHandoffAt = f.mtimeMs
    }
  } catch {
    // no session-logs yet
  }
  const project = cwd.split('/').filter(Boolean).at(-1) ?? cwd
  const next: Info = {
    email,
    project,
    progi: await readProgi($, home, project).catch(() => DOMYSLNE_PROGI),
    branch,
    model: await $.session.model().catch(() => undefined),
    turns: await $.session.turns().catch(() => 0),
    lastHandoffAt,
  }
  await update($, info, () => next)
  return { home, cwd }
}

// One JSON file per session so Agent Hub can warn about handoffs.
async function writeState($: EngineInterface, home: string | undefined, cwd: string) {
  if (!home) return
  const t = await $.clock.now()
  const snap = await read($, snapshot)
  const i = await read($, info)
  const cache = cacheState(await read($, lastResponseAt), t)
  const since = i?.lastHandoffAt !== undefined ? Math.floor((t - i.lastHandoffAt) / 60000) : undefined
  const id: string = await $.session.id()
  const state = {
    sessionId: id,
    cwd,
    project: i?.project,
    branch: i?.branch,
    model: i?.model,
    turns: i?.turns,
    contextPercent: snap?.contextPercent,
    contextTokens: snap?.contextTokens,
    contextWindow: snap?.contextWindow,
    fiveHour: snap?.fiveHour,
    sevenDay: snap?.sevenDay,
    cache: cache.kind,
    cacheLeftMin: Math.round(cache.leftMs / 60000),
    handoff: handoffState(snap?.contextPercent, since, i?.progi),
    progi: i?.progi,
    lastHandoffAt: i?.lastHandoffAt,
    updatedAt: t,
  }
  try {
    await $.fs.write(`${home}/${STATE_DIR}/${id}.json`, JSON.stringify(state, null, 2))
  } catch {
    // the bar still works without the shared file
  }
}

async function runAutoCycle($: EngineInterface) {
  const c = await read($, cycle)
  const snap = await read($, snapshot)
  const i = await read($, info)
  const t = await $.clock.now()
  const action = autoStep(await read($, autoOn), c, snap?.contextPercent, i?.lastHandoffAt, t, i?.progi)
  if (action === 'start') {
    await update($, cycle, () => ({ startedAt: t, turnsWaited: 0 }))
    $.ui.toast(`Kontekst ${snap?.contextPercent}% — automatyczny handoff: zapis, /clear, pickup.`)
    await $.prompt.submit({ text: HANDOFF_PROMPT })
  } else if (action === 'wait' && c !== null) {
    await update($, cycle, () => ({ ...c, turnsWaited: c.turnsWaited + 1 }))
  } else if (action === 'giveup') {
    await update($, cycle, () => null)
    $.ui.toast('Automatyczny handoff: nie powstał plik w session-logs/ — zrób handoff ręcznie.')
  } else if (action === 'finish') {
    await update($, cycle, () => null)
    $.ui.toast('Handoff zapisany — czyszczę rozmowę i wznawiam (pickup).')
    await $.command.run({ command: 'clear', args: '' })
    await $.prompt.submit({ text: PICKUP_PROMPT })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const saved = await $.store.get('autoOn')
      await update($, autoOn, () => saved !== false)
      await $.command.register({
        name: 'handoff-auto',
        description: 'Automatyczny handoff przy 50% kontekstu: on / off',
        argumentHint: '[on|off]',
      })
    } catch {
      // the bar works without the toggle
    }
    const t = await $.clock.now()
    await update($, now, () => t)
    try {
      await update($, snapshot, () => null)
      const u = await $.session.usage()
      await update($, snapshot, () => toSnapshot(u))
    } catch {
      // no figures yet: the bar waits for the first measurement
    }
    try {
      const { home, cwd } = await refreshInfo($)
      await writeState($, home, cwd)
    } catch {
      // the second line fills in after the first turn
    }
    // Tick every 30 s so the cache countdown and reset timers move.
    $.clock.every(30_000, async () => {
      const t2 = await $.clock.now()
      await update($, now, () => t2)
    })
    return next(e)
  })

  on('command.run', { command: 'handoff-auto' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const next = arg === 'on' ? true : arg === 'off' ? false : !(await read($, autoOn))
    await update($, autoOn, () => next)
    await $.store.set('autoOn', next)
    if (!next) await update($, cycle, () => null)
    return {
      text: next
        ? `Automatyczny handoff WŁĄCZONY: przy ${((await read($, info))?.progi ?? DOMYSLNE_PROGI).handoff}% kontekstu zapis do session-logs/, potem /clear i pickup. Próg zmienisz w Agent Hub: Projekt → Zaawansowane → Ustawienia („Przekaż pracę przy zajęciu okna”).`
        : 'Automatyczny handoff WYŁĄCZONY: zostaje przycisk [Handoff] na pasku.',
    }
  })

  on('session.measure', async ($, e, next) => {
    await update($, snapshot, () => toSnapshot(e))
    return next(e)
  })

  // Every model response on the main thread re-warms the cache.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.usage !== undefined) {
      const t = await $.clock.now()
      await update($, lastResponseAt, () => t)
      await update($, now, () => t)
      try {
        const { home, cwd } = await refreshInfo($)
        await writeState($, home, cwd)
      } catch {
        // keep the previous line two
      }
      // Outside this hook: /clear and a new prompt wait for the turn to settle.
      $.clock.after(1500, () => {
        void runAutoCycle($).catch(() => update($, cycle, () => null))
      })
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const snap = await read($, snapshot)
    const last = await read($, lastResponseAt)
    const t = await read($, now)
    const i = await read($, info)
    const { Box, Text, Button } = $.ui.resolve(e)

    const cache = cacheState(last, t)
    const cacheText = {
      unknown: 'Cache: –',
      warm: `🟢 Cache: aktywny (~${fmtDuration(cache.leftMs)})`,
      cooling: `🟡 Cache: chłodzenie (~${fmtDuration(cache.leftMs)})`,
      cold: '❄ Cache: zimny',
    }[cache.kind]
    const cacheColor = ({ unknown: 'subtle', warm: 'success', cooling: 'warning', cold: 'error' } as const)[cache.kind]

    const ctxPct = snap?.contextPercent
    const progi = i?.progi ?? DOMYSLNE_PROGI
    const poziom = handoffState(ctxPct, undefined, progi)
    const ctxColor = ctxPct === undefined ? 'text' : poziom === 'wymagany' ? 'error' : poziom === 'zalecany' ? 'warning' : 'success'
    const ctxText =
      ctxPct === undefined || snap === null
        ? 'Ctx: –'
        : `Ctx [${bar(ctxPct)}] ${ctxPct}% (${fmtTokens(snap.contextTokens ?? 0)}/${fmtTokens(snap.contextWindow)})`

    const since = i?.lastHandoffAt !== undefined ? Math.floor((t - i.lastHandoffAt) / 60000) : undefined
    const handoff = handoffState(ctxPct, since, progi)
    const handoffText = {
      zapisano: `📝 Handoff: zapisano (~${since}m)`,
      wymagany: '🚨 Handoff: wymagany!',
      zalecany: '⚠ Handoff: zalecany',
      ok: since !== undefined ? `📝 Handoff: OK (~${fmtDuration(since * 60000)})` : '📝 Handoff: OK',
    }[handoff]
    const isAuto = await read($, autoOn)
    const inCycle = (await read($, cycle)) !== null
    const handoffColor = ({ zapisano: 'success', wymagany: 'error', zalecany: 'warning', ok: 'subtle' } as const)[handoff]

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {i?.email && <Text dimColor>👤 {i.email} │</Text>}
          {i && (
            <Text>
              📁 {i.project}
              {i.branch ? ` (⎇ ${i.branch})` : ''} │
            </Text>
          )}
          {snap?.fiveHour && (
            <Text dimColor>
              ⏳ 5h [{bar(snap.fiveHour.percent, 8)}] {snap.fiveHour.percent}%{resetIn(snap.fiveHour, t)} │
            </Text>
          )}
          {snap?.sevenDay && (
            <Text dimColor>
              📅 Tydzień {snap.sevenDay.percent}%{resetIn(snap.sevenDay, t)} │
            </Text>
          )}
          {snap?.costUsd !== undefined && snap.fiveHour === undefined && (
            <Text dimColor>💲{snap.costUsd.toFixed(2)} │</Text>
          )}
          {i?.model && <Text dimColor>🧠 {i.model}</Text>}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text color={cacheColor}>{cacheText} │</Text>
          <Text color={ctxColor} bold={handoff === 'wymagany'}>
            📊 {ctxText} │
          </Text>
          {i && i.turns > 0 && <Text dimColor>🐾 Krok: {i.turns} │</Text>}
          <Text color={handoffColor} bold={handoff === 'wymagany'}>
            {inCycle ? '⏳ Handoff: trwa zapis…' : handoffText}
          </Text>
          <Text dimColor>{isAuto ? '🤖 auto' : '✋ ręcznie'}</Text>
          {(handoff === 'wymagany' || handoff === 'zalecany') && (
            <Button
              key="handoff"
              label="Handoff"
              variant="primary"
              onPress={() => {
                void $.prompt.submit({ text: HANDOFF_PROMPT })
                $.ui.toast('Handoff zlecony — potem /clear i „pickup”.')
              }}
            />
          )}
        </Box>
      </Box>
    )
  })
}
