import { describe, it, expect, vi } from 'vitest'
import { createEconomicCalendarService } from '../../../src/main/calendar/EconomicCalendarService'
import type { EconomicEvent } from '@shared/types'

// 2026-07-27 (Mon) 00:00Z = 1785110400。週の各日 12:00Z を epoch で扱う。
const DAY0 = Date.parse('2026-07-27T00:00:00Z') / 1000
const NOON = (dayOffset: number): number => DAY0 + dayOffset * 86400 + 12 * 3600
const ymd = (offset: number): string => new Date((DAY0 + offset * 86400) * 1000).toISOString().slice(0, 10)

const ev = (time: number, event = 'CPI'): EconomicEvent => ({
  time, country: 'US', currency: 'USD', event, impact: 'High',
  previous: null, estimate: null, actual: null
})

type Row = { date: string; events: EconomicEvent[]; fetchedAt: number }

function fakeStore(initial: Row[] = []) {
  const rows = new Map(initial.map((r) => [r.date, r]))
  return {
    rows,
    getDays: vi.fn((days: string[]) => days.flatMap((d) => (rows.has(d) ? [rows.get(d)!] : []))),
    upsertDays: vi.fn((next: Row[]) => { for (const r of next) rows.set(r.date, r) })
  }
}

// 週の月〜金 (2026-07-27..07-31) を要求範囲として使う。
const FROM = ymd(0)
const TO = ymd(4)
const DAYS = [ymd(0), ymd(1), ymd(2), ymd(3), ymd(4)]

// 全日を fetchedAt で埋めた行セット
const filled = (fetchedAt: number, events: EconomicEvent[] = []): Row[] =>
  DAYS.map((date) => ({ date, events: events.filter((e) => new Date(e.time * 1000).toISOString().slice(0, 10) === date), fetchedAt }))

describe('EconomicCalendarService.getRange — 確定判定 (EC-06)', () => {
  it('does not refetch a day whose row was fetched after that day ended (確定)', async () => {
    // その日の翌 00:00 UTC 以降に取得済み → 確定。now が遠い未来でも再取得しない。
    const store = fakeStore(filled(DAY0 + 5 * 86400, [ev(NOON(0))]))
    const fetch = vi.fn()
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    const r = await svc.getRange(FROM, TO)
    expect(fetch).not.toHaveBeenCalled()
    expect(r.events.map((e) => e.time)).toEqual([NOON(0)])
    expect(r.fetchedAt).toBe(DAY0 + 5 * 86400)
    expect(r.stale).toBeUndefined()
  })

  // 金曜 10:00Z に取った金曜の行は 13:30Z 発表分の actual が null。永続扱いにしてはいけない。
  it('refetches a row written before its own day ended, once past the TTL', async () => {
    const beforeDayEnd = DAY0 + 4 * 86400 + 10 * 3600 // Fri 10:00Z
    const rows = filled(DAY0 + 5 * 86400)
    rows[4] = { date: ymd(4), events: [], fetchedAt: beforeDayEnd }
    const store = fakeStore(rows)
    const fetch = vi.fn(async () => [ev(NOON(4), 'NFP')])
    const svc = createEconomicCalendarService({ store, fetch, now: () => beforeDayEnd + 4000 }) // > TTL 3600
    await svc.getRange(FROM, TO)
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(ymd(4), ymd(4))
  })

  it('does not refetch an unconfirmed row inside the 3600s TTL', async () => {
    const beforeDayEnd = DAY0 + 4 * 86400 + 10 * 3600
    const rows = filled(DAY0 + 5 * 86400)
    rows[4] = { date: ymd(4), events: [], fetchedAt: beforeDayEnd }
    const store = fakeStore(rows)
    const fetch = vi.fn()
    const svc = createEconomicCalendarService({ store, fetch, now: () => beforeDayEnd + 3599 })
    await svc.getRange(FROM, TO)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('EconomicCalendarService.getRange — 欠け範囲 (EC-07)', () => {
  it('folds non-contiguous missing days into a single min..max request', async () => {
    // Mon と Fri だけ欠け → Mon..Fri の 1 リクエスト（間の fresh な日も上書きされるが無害）
    const rows = filled(DAY0 + 5 * 86400).filter((r) => r.date !== ymd(0) && r.date !== ymd(4))
    const store = fakeStore(rows)
    const fetch = vi.fn(async () => [])
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    await svc.getRange(FROM, TO)
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(ymd(0), ymd(4))
  })

  it('makes exactly one request when nothing is cached', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [])
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    await svc.getRange(FROM, TO)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(FROM, TO)
  })
})

describe('EconomicCalendarService.getRange — 空日の行 (EC-08)', () => {
  it("writes a '[]' row for every requested day the response did not cover", async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [ev(NOON(1))])
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    await svc.getRange(FROM, TO)
    expect([...store.rows.keys()].sort()).toEqual(DAYS)
    expect(store.rows.get(ymd(0))!.events).toEqual([])
    expect(store.rows.get(ymd(1))!.events.map((e) => e.time)).toEqual([NOON(1)])
  })

  it('does not fetch again on a second call for the same range', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [ev(NOON(1))])
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    await svc.getRange(FROM, TO)
    const second = await svc.getRange(FROM, TO)
    expect(fetch).toHaveBeenCalledOnce()
    expect(second.events.map((e) => e.time)).toEqual([NOON(1)])
  })

  it('drops events that fall outside the requested range (provider widens by a day)', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [ev(NOON(-1), 'before'), ev(NOON(2), 'inside'), ev(NOON(5), 'after')])
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    const r = await svc.getRange(FROM, TO)
    expect(r.events.map((e) => e.event)).toEqual(['inside'])
    expect([...store.rows.keys()].sort()).toEqual(DAYS)
  })
})

describe('EconomicCalendarService.getRange — フェッチ失敗 (EC-18)', () => {
  it('returns stale: true when the fetch fails but every requested day has a row', async () => {
    const stale = DAY0 + 4 * 86400 + 10 * 3600
    const rows = filled(DAY0 + 5 * 86400, [ev(NOON(0))])
    rows[4] = { date: ymd(4), events: [], fetchedAt: stale }
    const store = fakeStore(rows)
    const fetch = vi.fn(async () => { throw new Error('rate limited') })
    const svc = createEconomicCalendarService({ store, fetch, now: () => stale + 4000 })
    const r = await svc.getRange(FROM, TO)
    expect(r.stale).toBe(true)
    expect(r.events.map((e) => e.time)).toEqual([NOON(0)])
    expect(r.fetchedAt).toBe(stale) // 表示対象の日で最も古い取得時刻
  })

  // '[]' の行は「その日は発表なし」の意味なので、行があるとみなす。
  it("treats an empty-events row as present, not missing", async () => {
    const store = fakeStore(filled(DAY0 + 5 * 86400)) // 全日 events: []
    const fetch = vi.fn(async () => { throw new Error('down') })
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    const r = await svc.getRange(FROM, TO, { force: true })
    expect(r).toEqual({ events: [], fetchedAt: DAY0 + 5 * 86400, stale: true })
  })

  it('throws when the fetch fails and some requested day has no row (mixed state)', async () => {
    // 月〜水はキャッシュ済み、木〜金は未取得。部分的な範囲を stale で返すと欠けが空に見える。
    const rows = filled(DAY0 + 5 * 86400, [ev(NOON(0))]).slice(0, 3)
    const store = fakeStore(rows)
    const fetch = vi.fn(async () => { throw new Error('down') })
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    await expect(svc.getRange(FROM, TO)).rejects.toThrow('down')
  })

  it('throws when the fetch fails and nothing is cached', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => { throw new Error('down') })
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    await expect(svc.getRange(FROM, TO)).rejects.toThrow('down')
  })
})

describe('EconomicCalendarService.getRange — force', () => {
  it('refetches every requested day, ignoring 確定 and TTL', async () => {
    const store = fakeStore(filled(DAY0 + 5 * 86400, [ev(NOON(0), 'old')]))
    const fetch = vi.fn(async () => [ev(NOON(0), 'new')])
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    const r = await svc.getRange(FROM, TO, { force: true })
    expect(fetch).toHaveBeenCalledExactlyOnceWith(FROM, TO)
    expect(r.events.map((e) => e.event)).toEqual(['new'])
    expect(r.fetchedAt).toBe(DAY0 + 60 * 86400)
  })
})

describe('EconomicCalendarService.getRange — ordering', () => {
  it('returns events sorted ascending across day boundaries', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [ev(NOON(3), 'd3'), ev(NOON(1), 'd1'), ev(NOON(2), 'd2')])
    const svc = createEconomicCalendarService({ store, fetch, now: () => DAY0 + 60 * 86400 })
    const r = await svc.getRange(FROM, TO)
    expect(r.events.map((e) => e.event)).toEqual(['d1', 'd2', 'd3'])
  })
})
