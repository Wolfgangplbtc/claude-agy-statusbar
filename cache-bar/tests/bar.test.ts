import { test, expect } from 'claude-code/testing'
import { autoStep, bar, cacheState, czytajProgi, fmtDuration, fmtTokens, handoffState } from '../hooks/register'

test('formatting helpers', async () => {
  expect(bar(50)).toBe('█████░░░░░')
  expect(fmtDuration(42 * 60000)).toBe('42m')
  expect(fmtDuration(125 * 60000)).toBe('2h05')
  expect(fmtTokens(812_000)).toBe('812k')
  expect(fmtTokens(1_000_000)).toBe('1.0M')
})

test('cache and handoff states match the agy bar', async () => {
  expect(cacheState(null, 0).kind).toBe('unknown')
  expect(cacheState(0, 10 * 60000).kind).toBe('warm')
  expect(cacheState(0, 50 * 60000).kind).toBe('cooling')
  expect(cacheState(0, 61 * 60000).kind).toBe('cold')
  expect(handoffState(60, 5)).toBe('zapisano')
  expect(handoffState(60, 90)).toBe('wymagany')
  expect(handoffState(30, undefined)).toBe('zalecany')
  expect(handoffState(10, undefined)).toBe('ok')
})

test('automatic handoff steps', () => {
  const H = 3_600_000
  expect(autoStep(true, null, 30, undefined, H)).toBe('none')
  expect(autoStep(false, null, 60, undefined, H)).toBe('none')
  expect(autoStep(true, null, 60, undefined, H)).toBe('start')
  expect(autoStep(true, null, 60, H - 5 * 60000, H)).toBe('none')
  expect(autoStep(true, null, 60, 0, H)).toBe('start')
  expect(autoStep(true, { startedAt: 100, turnsWaited: 0 }, 60, 50, H)).toBe('wait')
  expect(autoStep(true, { startedAt: 100, turnsWaited: 0 }, 60, 200, H)).toBe('finish')
  expect(autoStep(true, { startedAt: 100, turnsWaited: 2 }, 60, undefined, H)).toBe('giveup')
})

test('progi z ustawień Agent Hub: wspólne, potem projekt; 0 wyłącza', () => {
  const p = czytajProgi(['# x\nPROG_PRZEKAZANIA=40\nPROG_ZWISU=6', 'PROG_PRZEKAZANIA=30 # wlasne\nPROG_OSTRZEZENIA=20'])
  expect(p).toEqual({ handoff: 30, advise: 20 })
  expect(czytajProgi([])).toEqual({ handoff: 35, advise: 25 })
  expect(handoffState(36, undefined)).toBe('wymagany')
  expect(handoffState(30, undefined)).toBe('zalecany')
  expect(handoffState(90, undefined, { handoff: 0, advise: 0 })).toBe('ok')
  expect(autoStep(true, null, 90, undefined, 3_600_000, { handoff: 0, advise: 0 })).toBe('none')
})
