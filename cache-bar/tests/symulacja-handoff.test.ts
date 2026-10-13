import { test, expect, mock } from 'claude-code/testing'

// Symulacja całego automatu bez czekania na prawdziwe 50%: test udaje Claude Code
// pod pluginem (kontekst, pliki, polecenia) i zapisuje, co plugin wysłał.

type Swiat = {
  clock: ReturnType<typeof mock.clock>
  prompts: string[]
  commands: string[]
  setHandoff: (mtimeMs: number) => void
}

const swiat = (on: any, store: Record<string, unknown> = {}): Swiat => {
  const clock = mock.clock(on, { now: 10_000_000 })
  mock.store(on, store)
  mock.env(on, { HOME: '/home/test' })
  const prompts: string[] = []
  const commands: string[] = []
  let handoffAt: number | undefined
  const usage = {
    startedAt: 0,
    context: { tokens: 550_000, window: 1_000_000, percent: 55 },
    rateLimits: [],
  }
  on('session.start', async () => ({ cwd: '/home/test/projekt' }))
  on('turn.complete', async () => ({ text: 'ok' }))
  on('session.measure', async () => ({}))
  on('session.cwd', async () => ({ value: '/home/test/projekt' }))
  on('session.id', async () => ({ value: 'sesja-test' }))
  on('session.model', async () => ({ value: 'claude-test' }))
  on('session.turns', async () => ({ value: 3 }))
  on('session.usage', async () => ({ value: usage }))
  on('process.run', async () => ({
    value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.read', async () => ({ deny: 'brak pliku' }))
  on('fs.write', async () => ({ value: undefined }))
  on('fs.list', async () => ({
    value:
      handoffAt === undefined
        ? []
        : [{ name: '2026-10-13_1200_test.md', kind: 'file', size: 100, mtimeMs: handoffAt, isLink: false }],
  }))
  on('command.register', async (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('command.run', async (_$: unknown, e: { command: string }) => {
    commands.push(e.command)
    return { text: '' }
  })
  on('prompt.submit', async (_$: unknown, e: { text: string }) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  return { clock, prompts, commands, setHandoff: t => (handoffAt = t) }
}

// Jedna odpowiedź Claude'a w głównym wątku, potem 2 s na krok automatu.
const odpowiedz = async ($: any, w: Swiat) => {
  await $.turn.complete({
    turnId: `t${w.clock.now()}`,
    answer: 'ok',
    durationMs: 100,
    isAborted: false,
    reason: 'answer',
    category: null,
    explanation: null,
    usage: { model: 'claude-test' },
  })
  await w.clock.advance(2000)
}

test('symulacja: 55% kontekstu → handoff → /clear → pickup', async ($: any, on: any) => {
  const w = swiat(on)
  await $.session.start({ cwd: '/home/test/projekt', surface: null, isInteractive: true })

  // 1. Odpowiedź przy 55% → plugin sam zleca handoff.
  await odpowiedz($, w)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('session-handoff')
  expect(w.commands).toEqual([])

  // 2. "Claude" zapisał plik w session-logs/ → następna odpowiedź → /clear i pickup.
  w.setHandoff(w.clock.now() + 500)
  await w.clock.advance(1000)
  await odpowiedz($, w)
  expect(w.commands).toEqual(['clear'])
  expect(w.prompts[1]).toBe('pickup')
})

test('symulacja: plik nie powstaje → po 3 odpowiedziach odpuszcza, bez /clear', async ($: any, on: any) => {
  const w = swiat(on)
  await $.session.start({ cwd: '/home/test/projekt', surface: null, isInteractive: true })
  await odpowiedz($, w) // start
  await odpowiedz($, w) // czeka 1
  await odpowiedz($, w) // czeka 2
  await odpowiedz($, w) // odpuszcza
  expect(w.prompts.length).toBe(1)
  expect(w.commands).toEqual([])
})

test('symulacja: /handoff-auto off → przy 55% nic się nie dzieje', async ($: any, on: any) => {
  const w = swiat(on, { autoOn: false })
  await $.session.start({ cwd: '/home/test/projekt', surface: null, isInteractive: true })
  await odpowiedz($, w)
  expect(w.prompts).toEqual([])
  expect(w.commands).toEqual([])
})
