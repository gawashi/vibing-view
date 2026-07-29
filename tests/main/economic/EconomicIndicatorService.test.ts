import { describe, it, expect, vi } from 'vitest'
import { createEconomicIndicatorService } from '../../../src/main/economic/EconomicIndicatorService'
import type { EconomicIndicatorPoint } from '@shared/types'

// 2026-07-27T00:00:00Z。now を注入するのでテストは日付に依存しない。
const T0 = Date.parse('2026-07-27T00:00:00Z') / 1000
const TODAY = '2026-07-27'
const TTL = 43200 // 12h

// 1Y 地平の下限。文字列で年だけ引く（service と同じ計算）。
const FROM_1Y = '2025-07-27'
const FROM_5Y = '2021-07-27'

const PTS: EconomicIndicatorPoint[] = [
  { date: '2026-04-01', value: 320.5 },
  { date: '2026-05-01', value: 321.4 },
  { date: '2026-06-01', value: 322.1 }
]

type Row = { points: EconomicIndicatorPoint[]; coveredFrom: string; fetchedAt: number }

function fakeStore(initial: Record<string, Row> = {}) {
  const rows = new Map(Object.entries(initial))
  return {
    rows,
    getIndicator: vi.fn((name: string) => rows.get(name) ?? null),
    upsertIndicator: vi.fn((name: string, points: EconomicIndicatorPoint[], coveredFrom: string, fetchedAt: number) => {
      rows.set(name, { points, coveredFrom, fetchedAt })
    })
  }
}

const svc = (store: ReturnType<typeof fakeStore>, fetch: ReturnType<typeof vi.fn>, now = T0) =>
  createEconomicIndicatorService({ store, fetch, now: () => now })

const tos = (fetch: ReturnType<typeof vi.fn>): string[] => fetch.mock.calls.map((c) => c[1] as string)

describe('getSeries — 90 日窓の遡り（初回）', () => {
  it('walks `to` back in 85-day steps until the 1Y horizon is covered', async () => {
    const store = fakeStore()
    const fetch = vi.fn<(name: string, to: string) => Promise<EconomicIndicatorPoint[]>>(async () => [])
    await svc(store, fetch).getSeries('CPI', { years: 1 })

    // 最初は今日、以降 85 日ずつ。最後の窓の下端（to - 90d）が地平を下回るまで。
    expect(tos(fetch)).toEqual(['2026-07-27', '2026-05-03', '2026-02-07', '2025-11-14', '2025-08-21'])
    // 5 リクエスト = 設計書の「1Y の初回で約 5」
    expect(fetch).toHaveBeenCalledTimes(5)
    for (const [name] of fetch.mock.calls) expect(name).toBe('CPI')
  })

  it('needs about 22 requests for the 5Y horizon', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [])
    await svc(store, fetch).getSeries('CPI', { years: 5 })
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(21)
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(23)
    expect(tos(fetch)[0]).toBe(TODAY)
  })

  it('the windows overlap so no observation can fall through a seam', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [])
    await svc(store, fetch).getSeries('CPI', { years: 1 })

    const step = (a: string, b: string): number =>
      (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
    const list = tos(fetch)
    for (let i = 1; i < list.length; i++) expect(step(list[i - 1], list[i])).toBeLessThan(90)
  })

  it('defaults to the 1Y horizon', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [])
    await svc(store, fetch).getSeries('CPI')
    expect(fetch).toHaveBeenCalledTimes(5)
  })
})

describe('getSeries — マージ', () => {
  it('unions the windows by date and returns them ascending', async () => {
    const store = fakeStore()
    // 窓ごとに 1 点ずつ、順序はばらばらに返す。
    const perWindow: Record<string, EconomicIndicatorPoint[]> = {
      '2026-07-27': [{ date: '2026-06-01', value: 3 }],
      '2026-05-03': [{ date: '2026-04-01', value: 1 }, { date: '2026-05-01', value: 2 }]
    }
    const fetch = vi.fn(async (_n: string, to: string) => perWindow[to] ?? [])
    const r = await svc(store, fetch).getSeries('CPI', { years: 1 })

    expect(r.points).toEqual([
      { date: '2026-04-01', value: 1 },
      { date: '2026-05-01', value: 2 },
      { date: '2026-06-01', value: 3 }
    ])
  })

  it('lets a later window win for the same date (改訂を取り込む)', async () => {
    // 窓が重なるので同じ date が 2 回来る。後から取った値が勝つ。
    const store = fakeStore({
      CPI: { points: [{ date: '2026-06-01', value: 100 }], coveredFrom: FROM_1Y, fetchedAt: T0 - TTL }
    })
    const fetch = vi.fn(async () => [{ date: '2026-06-01', value: 322.1 }])
    const r = await svc(store, fetch).getSeries('CPI', { years: 1 })
    expect(r.points).toEqual([{ date: '2026-06-01', value: 322.1 }])
  })

  it('never drops cached observations that the new windows do not contain', async () => {
    const store = fakeStore({
      CPI: { points: PTS, coveredFrom: FROM_1Y, fetchedAt: T0 - TTL }
    })
    const fetch = vi.fn(async () => []) // 四半期系列のように空窓が返る
    const r = await svc(store, fetch).getSeries('CPI', { years: 1 })
    expect(r.points).toEqual(PTS)
    expect(r.stale).toBeUndefined() // 空応答は異常ではない（EI-10 改訂）
  })
})

describe('getSeries — キャッシュ判定', () => {
  it('serves from cache when the horizon is covered and the TTL has not elapsed', async () => {
    const store = fakeStore({ CPI: { points: PTS, coveredFrom: FROM_1Y, fetchedAt: T0 } })
    const fetch = vi.fn()
    const r = await svc(store, fetch, T0 + TTL - 1).getSeries('CPI', { years: 1 })

    expect(fetch).not.toHaveBeenCalled()
    expect(r).toEqual({ name: 'CPI', points: PTS, coveredFrom: FROM_1Y, fetchedAt: T0 })
    expect(r.stale).toBeUndefined()
  })

  it('refetches only the latest window once the TTL has elapsed', async () => {
    const store = fakeStore({ CPI: { points: PTS, coveredFrom: FROM_1Y, fetchedAt: T0 - TTL } })
    const fetch = vi.fn(async () => [{ date: '2026-07-01', value: 323 }])
    const r = await svc(store, fetch).getSeries('CPI', { years: 1 })

    expect(tos(fetch)).toEqual([TODAY]) // 遡りは走らない
    expect(r.points.at(-1)).toEqual({ date: '2026-07-01', value: 323 })
    expect(r.coveredFrom).toBe(FROM_1Y) // 地平は動かない
  })

  it('backfills without refetching the latest window when the row is still fresh', async () => {
    const store = fakeStore({ CPI: { points: PTS, coveredFrom: FROM_1Y, fetchedAt: T0 } })
    const fetch = vi.fn(async () => [])
    await svc(store, fetch).getSeries('CPI', { years: 5 })

    // TTL 内なので今日の窓は取り直さない。1Y の下限から 5Y の下限までを遡るだけ。
    expect(tos(fetch)).not.toContain(TODAY)
    expect(tos(fetch)[0]).toBe(FROM_1Y)
    expect(fetch.mock.calls.length).toBeGreaterThan(10)
  })

  it('widens the refresh past a single window when the row is dormant for >90 days (穴を残さない)', async () => {
    // fetchedAt が ~150 日前。1 窓（today だけ）では [前回取得日+90d, today) が永久に埋まらない穴になる。
    const staleFetchedAt = T0 - 150 * 86400
    const store = fakeStore({ CPI: { points: PTS, coveredFrom: FROM_1Y, fetchedAt: staleFetchedAt } })
    const fetch = vi.fn(async () => [])
    await svc(store, fetch).getSeries('CPI', { years: 1 })

    const list = tos(fetch)
    expect(list.length).toBeGreaterThanOrEqual(2)
    // 一番古い窓の下端（-90d）が前回取得日以前に届いていること。
    const oldestTo = list[list.length - 1]
    const oldestLowerBound = new Date(Date.parse(`${oldestTo}T00:00:00Z`) - 90 * 86400_000)
    expect(oldestLowerBound.getTime()).toBeLessThanOrEqual(staleFetchedAt * 1000)
  })

  it('refreshes a row whose fetchedAt is in the future (時計の後退)', async () => {
    // 時計が進んだ状態で書かれた行。差が負なので TTL 判定だけでは永久に新鮮扱いになる。
    const store = fakeStore({ CPI: { points: PTS, coveredFrom: FROM_1Y, fetchedAt: T0 + 30 * 86400 } })
    const fetch = vi.fn(async () => [])
    const r = await svc(store, fetch).getSeries('CPI', { years: 1 })

    expect(tos(fetch)).toEqual([TODAY]) // 今日の窓だけ取り直す（遡りは走らない）
    expect(r.fetchedAt).toBe(T0) // 未来日付が正常な値に書き戻る
  })

  it('does not refetch when narrowing the horizon back to 1Y', async () => {
    const store = fakeStore({ CPI: { points: PTS, coveredFrom: FROM_5Y, fetchedAt: T0 } })
    const fetch = vi.fn()
    const r = await svc(store, fetch).getSeries('CPI', { years: 1 })

    expect(fetch).not.toHaveBeenCalled()
    expect(r.coveredFrom).toBe(FROM_5Y) // 広いカバー範囲を狭めない
  })

  it('keys the cache per indicator (CPI の行が GDP に効かない)', async () => {
    const store = fakeStore({ CPI: { points: PTS, coveredFrom: FROM_1Y, fetchedAt: T0 } })
    const fetch = vi.fn<(name: string, to: string) => Promise<EconomicIndicatorPoint[]>>(async () => [])
    await svc(store, fetch).getSeries('GDP', { years: 1 })
    for (const [name] of fetch.mock.calls) expect(name).toBe('GDP')
  })

  it('writes coveredFrom = the requested horizon on a first fetch', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => PTS)
    const r = await svc(store, fetch).getSeries('CPI', { years: 1 })
    expect(r.coveredFrom).toBe(FROM_1Y)
    expect(store.rows.get('CPI')!.coveredFrom).toBe(FROM_1Y)
    expect(store.rows.get('CPI')!.fetchedAt).toBe(T0)
  })
})

describe('getSeries — 同時実行', () => {
  it('does not undo a wider write that landed while it was fetching', async () => {
    // 1Y の要求が空キャッシュを snapshot したあと、5Y の要求が先に書き終わるケース。
    const store = fakeStore()
    const wide: EconomicIndicatorPoint[] = [{ date: '2022-01-01', value: 1 }, { date: '2026-06-01', value: 2 }]
    let n = 0
    const fetch = vi.fn(async () => {
      // 3 窓目の途中で 5Y の要求が完了したことにする。
      if (++n === 3) store.upsertIndicator('CPI', wide, FROM_5Y, T0)
      return [{ date: '2026-07-01', value: 323 }]
    })
    const r = await svc(store, fetch).getSeries('CPI', { years: 1 })

    expect(r.coveredFrom).toBe(FROM_5Y) // 記録上のカバー範囲を巻き戻さない
    expect(r.points).toEqual([...wide, { date: '2026-07-01', value: 323 }])
    expect(store.rows.get('CPI')).toEqual({ points: r.points, coveredFrom: FROM_5Y, fetchedAt: T0 })
  })

  it('keeps its own freshly fetched value for a date the other write also touched', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => {
      store.upsertIndicator('CPI', [{ date: '2026-06-01', value: 100 }], FROM_1Y, T0)
      return [{ date: '2026-06-01', value: 322.1 }]
    })
    const r = await svc(store, fetch).getSeries('CPI', { years: 1 })
    expect(r.points).toEqual([{ date: '2026-06-01', value: 322.1 }])
  })
})

describe('getSeries — force', () => {
  it('discards the row and refetches the current horizon', async () => {
    const store = fakeStore({
      CPI: { points: [{ date: '2026-06-01', value: 100 }], coveredFrom: FROM_5Y, fetchedAt: T0 }
    })
    const fetch = vi.fn(async () => [{ date: '2026-06-01', value: 322.1 }])
    const r = await svc(store, fetch).getSeries('CPI', { years: 1, force: true })

    expect(fetch).toHaveBeenCalledTimes(5) // TTL もカバー範囲も無視して 1Y ぶん取り直す
    expect(r.points).toEqual([{ date: '2026-06-01', value: 322.1 }])
    expect(r.coveredFrom).toBe(FROM_1Y) // 捨てたので 5Y のカバーは失われる（明示的な操作）
  })
})

describe('getSeries — フェッチ失敗', () => {
  it('returns the untouched cached row with stale: true', async () => {
    const store = fakeStore({ CPI: { points: PTS, coveredFrom: FROM_1Y, fetchedAt: T0 - TTL } })
    const fetch = vi.fn(async () => { throw new Error('down') })
    const r = await svc(store, fetch).getSeries('CPI', { years: 1 })

    expect(r).toEqual({ name: 'CPI', points: PTS, coveredFrom: FROM_1Y, fetchedAt: T0 - TTL, stale: true })
    expect(store.upsertIndicator).not.toHaveBeenCalled()
  })

  it('does not advance coveredFrom when a backfill window fails halfway', async () => {
    const store = fakeStore({ CPI: { points: PTS, coveredFrom: FROM_1Y, fetchedAt: T0 } })
    let n = 0
    const fetch = vi.fn(async () => {
      if (++n > 3) throw new Error('down')
      return [{ date: '2024-01-01', value: 1 }]
    })
    const r = await svc(store, fetch).getSeries('CPI', { years: 5 })

    // 途中まで取れていても書かない。covered_from を進めると埋まっていない範囲を
    // 「取得済み」と嘘をつき、以後その穴は永久に埋まらない。
    expect(store.upsertIndicator).not.toHaveBeenCalled()
    expect(r).toEqual({ name: 'CPI', points: PTS, coveredFrom: FROM_1Y, fetchedAt: T0, stale: true })
  })

  it('rethrows when nothing is cached', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => { throw new Error('down') })
    await expect(svc(store, fetch).getSeries('CPI', { years: 1 })).rejects.toThrow('down')
    expect(store.upsertIndicator).not.toHaveBeenCalled()
  })

  it('falls back to the existing row even under force', async () => {
    const store = fakeStore({ CPI: { points: PTS, coveredFrom: FROM_1Y, fetchedAt: T0 } })
    const fetch = vi.fn(async () => { throw new Error('down') })
    const r = await svc(store, fetch).getSeries('CPI', { years: 1, force: true })
    expect(r).toEqual({ name: 'CPI', points: PTS, coveredFrom: FROM_1Y, fetchedAt: T0, stale: true })
  })
})

describe('getSeries — 空応答（EI-10 改訂）', () => {
  it('writes an empty row when every window is empty (毎回の空撃ちを防ぐ)', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [])
    const r = await svc(store, fetch).getSeries('retired', { years: 1 })

    expect(r).toEqual({ name: 'retired', points: [], coveredFrom: FROM_1Y, fetchedAt: T0 })
    expect(store.rows.get('retired')).toEqual({ points: [], coveredFrom: FROM_1Y, fetchedAt: T0 })
  })

  it('goes quiet for the TTL after an empty result', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [])
    let now = T0
    const s = createEconomicIndicatorService({ store, fetch, now: () => now })

    await s.getSeries('GDP', { years: 1 })
    const first = fetch.mock.calls.length
    now += 1
    await s.getSeries('GDP', { years: 1 })
    expect(fetch).toHaveBeenCalledTimes(first) // 2 度目はネットワークに出ない
  })
})
