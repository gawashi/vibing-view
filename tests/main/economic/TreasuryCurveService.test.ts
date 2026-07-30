import { describe, it, expect, vi } from 'vitest'
import { createTreasuryCurveService, STEP_DAYS } from '../../../src/main/economic/TreasuryCurveService'
import { shiftUtcDay } from '@shared/utcDay'
import { MATURITIES } from '@shared/treasury'
import type { TreasuryCurvePoint, TreasuryMaturityKey } from '@shared/types'

// 2026-07-30T00:00:00Z。now を注入するのでテストは実際の日付に依存しない。
const T0 = Date.parse('2026-07-30T00:00:00Z') / 1000
const TODAY = '2026-07-30'
const TTL = 43200 // 12h
const FROM_1Y = '2025-07-30'
const FROM_5Y = '2021-07-30'
const ID = 'us'

// 12 満期すべてに同じ値を入れたカーブ。サービスは rates の中身を見ないので値に意味は無い。
const curve = (date: string, v = 4): TreasuryCurvePoint => ({
  date,
  rates: Object.fromEntries(MATURITIES.map((m) => [m.key, v])) as Record<TreasuryMaturityKey, number | null>
})

// 期待窓数は固定クロックと STEP_DAYS から計算する。22 のような数字を直接書くと、STEP_DAYS を
// 実測値に変えたときにテストだけが落ちる。
const windowCount = (from: string, to: string): number => {
  let n = 0
  for (let t = to; t >= from; t = shiftUtcDay(t, -STEP_DAYS)) n++
  return n
}

type Row = { points: TreasuryCurvePoint[]; coveredFrom: string; fetchedAt: number }

function fakeStore(initial?: Row) {
  const rows = new Map<string, Row>()
  if (initial) rows.set(ID, initial)
  return {
    rows,
    getCurves: vi.fn((id: string) => rows.get(id) ?? null),
    upsertCurves: vi.fn((id: string, points: TreasuryCurvePoint[], coveredFrom: string, fetchedAt: number) => {
      rows.set(id, { points, coveredFrom, fetchedAt })
    })
  }
}

const svc = (store: ReturnType<typeof fakeStore>, fetch: ReturnType<typeof vi.fn>, now = T0) =>
  createTreasuryCurveService({ store, fetch, now: () => now })

// 要求窓ぶんをそのまま返す（API 上限が STEP_DAYS 以上あるケース）。
const fullWindows = () =>
  vi.fn(async (from: string, to: string) => [curve(from), curve(to)])

const froms = (fetch: ReturnType<typeof vi.fn>): string[] => fetch.mock.calls.map((c) => c[0] as string)
const tos = (fetch: ReturnType<typeof vi.fn>): string[] => fetch.mock.calls.map((c) => c[1] as string)

describe('窓数の期待値（設計書の 5 本 / 22 本を固定クロックで確認）', () => {
  it('1Y = 5 windows, 5Y = 22 windows at STEP_DAYS = 85', () => {
    expect(STEP_DAYS).toBe(85)
    expect(windowCount(FROM_1Y, TODAY)).toBe(5)
    expect(windowCount(FROM_5Y, TODAY)).toBe(22)
  })
})

describe('getCurves — 初回取得', () => {
  it('walks [wantFrom, today] newest-first and stores everything it got', async () => {
    const store = fakeStore()
    const fetch = fullWindows()
    const r = await svc(store, fetch).getCurves({ years: 1 })

    expect(fetch).toHaveBeenCalledTimes(windowCount(FROM_1Y, TODAY))
    expect(tos(fetch)[0]).toBe(TODAY)
    expect(froms(fetch)[0]).toBe(shiftUtcDay(TODAY, -STEP_DAYS))
    expect(r.coveredFrom).toBe(FROM_1Y)
    expect(r.fetchedAt).toBe(T0)
    expect(r.stale).toBeUndefined()
    expect(store.upsertCurves).toHaveBeenCalledOnce()
  })

  it('leaves no gap between consecutive windows', async () => {
    const store = fakeStore()
    const fetch = fullWindows()
    await svc(store, fetch).getCurves({ years: 1 })

    // 次の窓の to は前の窓の from（1 日重なる）。隙間があるとその日は誰にも取得されない。
    const f = froms(fetch)
    const t = tos(fetch)
    for (let i = 1; i < t.length; i++) expect(t[i]).toBe(f[i - 1])
  })

  it('needs 22 windows for the 5Y horizon from scratch', async () => {
    const store = fakeStore()
    const fetch = fullWindows()
    await svc(store, fetch).getCurves({ years: 5 })
    expect(fetch).toHaveBeenCalledTimes(windowCount(FROM_5Y, TODAY))
  })

  it('defaults to the 1Y horizon', async () => {
    const store = fakeStore()
    const fetch = fullWindows()
    await svc(store, fetch).getCurves()
    expect(fetch).toHaveBeenCalledTimes(windowCount(FROM_1Y, TODAY))
  })

  it('returns points sorted by date', async () => {
    const store = fakeStore()
    // 窓は新しい側から取るので、マージ順は日付順にならない。provider が昇順で返す契約なので
    // 窓の中身は昇順で渡す（降順で渡すと rows[0] が最古でなくなり、遡りが 1 日ずつになる）。
    const fetch = vi.fn(async (_f: string, to: string) => [curve(shiftUtcDay(to, -3)), curve(to)])
    const r = await svc(store, fetch).getCurves({ years: 1 })
    const dates = r.points.map((p) => p.date)
    expect([...dates].sort()).toEqual(dates)
  })
})

describe('getCurves — 応答が要求窓より狭いとき（YC-02）', () => {
  it('follows the oldest returned date instead of the constant', async () => {
    const store = fakeStore()
    // API 上限が 30 日しかないケース: 要求した from より新しい日しか返さない。
    const fetch = vi.fn(async (_f: string, to: string) => [curve(shiftUtcDay(to, -30)), curve(to)])
    await svc(store, fetch).getCurves({ years: 1 })

    // 2 本目の to は「返ってきた最古の 1 日前」。定数どおり進めると 55 日ぶんの穴が空く。
    expect(tos(fetch)[1]).toBe(shiftUtcDay(TODAY, -31))
    expect(tos(fetch)[2]).toBe(shiftUtcDay(TODAY, -62))
    // 追従しても地平は埋まる（無限ループしない）。
    expect(store.rows.get(ID)!.coveredFrom).toBe(FROM_1Y)
  })
})

describe('getCurves — キャッシュ判定', () => {
  it('serves from cache inside the TTL when the horizon is covered', async () => {
    const store = fakeStore({ points: [curve(TODAY)], coveredFrom: FROM_1Y, fetchedAt: T0 })
    const fetch = vi.fn()
    const r = await svc(store, fetch, T0 + TTL - 1).getCurves({ years: 1 })

    expect(fetch).not.toHaveBeenCalled()
    expect(r).toEqual({ points: [curve(TODAY)], coveredFrom: FROM_1Y, fetchedAt: T0 })
  })

  it('refetches only the latest window once the TTL has elapsed', async () => {
    const store = fakeStore({ points: [curve('2026-07-29')], coveredFrom: FROM_1Y, fetchedAt: T0 - TTL })
    const fetch = fullWindows()
    const r = await svc(store, fetch).getCurves({ years: 1 })

    expect(fetch).toHaveBeenCalledOnce() // 遡りは走らない
    expect(tos(fetch)).toEqual([TODAY])
    expect(r.coveredFrom).toBe(FROM_1Y)
    expect(r.points.some((p) => p.date === '2026-07-29')).toBe(true) // 既存行は残る
  })

  it('covers the whole gap when the row is older than STEP_DAYS', async () => {
    // 前回取得から 200 日開いた行を 1 窓だけで更新すると、その間が誰にも取得されない穴として残る。
    const fetchedAt = T0 - 200 * 86400
    const store = fakeStore({ points: [curve('2026-01-11')], coveredFrom: FROM_5Y, fetchedAt })
    const fetch = fullWindows()
    await svc(store, fetch).getCurves({ years: 1 })

    expect(fetch).toHaveBeenCalledTimes(windowCount(shiftUtcDay(TODAY, -200), TODAY))
  })

  it('backfills from coveredFrom when the horizon widens (1Y → 5Y)', async () => {
    const store = fakeStore({ points: [curve(TODAY)], coveredFrom: FROM_1Y, fetchedAt: T0 })
    const fetch = fullWindows()
    const r = await svc(store, fetch).getCurves({ years: 5 })

    // TTL 内なので直近窓は取り直さない。1Y の下限から 5Y の下限までを遡るだけ。
    // 一括で 5Y を取る（22 本）より 1 本多いのは、遡りの起点が既存カバーの下限そのものだから。
    expect(fetch).toHaveBeenCalledTimes(windowCount(FROM_5Y, FROM_1Y))
    expect(tos(fetch)[0]).toBe(FROM_1Y)
    expect(r.coveredFrom).toBe(FROM_5Y)
  })

  it('does not refetch when narrowing the horizon back to 1Y', async () => {
    const store = fakeStore({ points: [curve(TODAY)], coveredFrom: FROM_5Y, fetchedAt: T0 })
    const fetch = vi.fn()
    const r = await svc(store, fetch).getCurves({ years: 1 })

    expect(fetch).not.toHaveBeenCalled()
    expect(r.coveredFrom).toBe(FROM_5Y) // 広いカバー範囲を狭めない
  })

  it('refetches when fetched_at is in the future (clock went backwards)', async () => {
    const store = fakeStore({ points: [curve(TODAY)], coveredFrom: FROM_1Y, fetchedAt: T0 + 10 * TTL })
    const fetch = fullWindows()
    const r = await svc(store, fetch).getCurves({ years: 1 })

    expect(fetch).toHaveBeenCalledOnce()
    expect(tos(fetch)).toEqual([TODAY])
    expect(r.fetchedAt).toBe(T0) // 未来の値を正常な now に書き戻す
  })
})

describe('getCurves — date union マージ', () => {
  it('lets the refetched window win for the same date and keeps the rest', async () => {
    const store = fakeStore({
      points: [curve('2026-07-29', 1), curve('2020-01-02', 1)],
      coveredFrom: FROM_5Y,
      fetchedAt: T0 - TTL
    })
    const fetch = vi.fn(async () => [curve('2026-07-29', 9)])
    const r = await svc(store, fetch).getCurves({ years: 1 })

    expect(r.points.find((p) => p.date === '2026-07-29')!.rates.year10).toBe(9)
    // 窓の外の履歴（5Y 地平で取った 2020 年）は残る
    expect(r.points.find((p) => p.date === '2020-01-02')!.rates.year10).toBe(1)
  })

  it('re-reads the store immediately before writing (別の地平要求との競合)', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async (_f: string, to: string) => {
      // 直列フェッチ中に、別の getCurves（5Y）が書き終えた状況を作る。
      store.rows.set(ID, { points: [curve('2021-08-02')], coveredFrom: FROM_5Y, fetchedAt: T0 })
      return [curve(to)]
    })
    const r = await svc(store, fetch).getCurves({ years: 1 })

    // 判定時の snapshot（行なし）のまま書くと、相手の履歴と coveredFrom を丸ごと捨てて
    // 次の 5Y 表示で 22 本取り直すことになる。
    expect(r.points.some((p) => p.date === '2021-08-02')).toBe(true)
    expect(r.coveredFrom).toBe(FROM_5Y)
  })
})

describe('getCurves — 空応答は取得失敗（YC-05: 統計指標と逆）', () => {
  it('returns the untouched row with stale: true and never advances coveredFrom', async () => {
    const store = fakeStore({ points: [curve('2026-07-29')], coveredFrom: FROM_1Y, fetchedAt: T0 })
    const fetch = vi.fn(async () => [])
    const r = await svc(store, fetch).getCurves({ years: 5 })

    // 85 日窓に営業日が 1 日も無いことはないので、空応答は 200 + 空配列のプラン拒否か仕様変更。
    // 前進させると coveredFrom が穴を跨いで「取得済み」になり、その穴は二度と埋まらない。
    expect(store.upsertCurves).not.toHaveBeenCalled()
    expect(r).toEqual({ points: [curve('2026-07-29')], coveredFrom: FROM_1Y, fetchedAt: T0, stale: true })
  })

  it('stops at the first empty window instead of walking the rest', async () => {
    const store = fakeStore({ points: [curve('2026-07-29')], coveredFrom: FROM_1Y, fetchedAt: T0 })
    const fetch = vi.fn(async () => [])
    await svc(store, fetch).getCurves({ years: 5 })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('throws when nothing is cached', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => [])
    await expect(svc(store, fetch).getCurves({ years: 1 })).rejects.toThrow(/EMPTY/)
    expect(store.upsertCurves).not.toHaveBeenCalled()
  })
})

describe('getCurves — フェッチ失敗', () => {
  it('returns the cached row with stale: true and writes nothing', async () => {
    const store = fakeStore({ points: [curve('2026-07-29')], coveredFrom: FROM_1Y, fetchedAt: T0 - TTL })
    const fetch = vi.fn(async () => { throw new Error('down') })
    const r = await svc(store, fetch).getCurves({ years: 1 })

    expect(r).toEqual({ points: [curve('2026-07-29')], coveredFrom: FROM_1Y, fetchedAt: T0 - TTL, stale: true })
    expect(store.upsertCurves).not.toHaveBeenCalled()
  })

  it('does not advance coveredFrom when a backfill window fails halfway', async () => {
    const store = fakeStore({ points: [curve(TODAY)], coveredFrom: FROM_1Y, fetchedAt: T0 })
    let n = 0
    const fetch = vi.fn(async (_f: string, to: string) => {
      if (++n > 3) throw new Error('down')
      return [curve(to)]
    })
    const r = await svc(store, fetch).getCurves({ years: 5 })

    expect(store.upsertCurves).not.toHaveBeenCalled()
    expect(r.coveredFrom).toBe(FROM_1Y)
    expect(r.stale).toBe(true)
  })

  it('rethrows when nothing is cached', async () => {
    const store = fakeStore()
    const fetch = vi.fn(async () => { throw new Error('down') })
    await expect(svc(store, fetch).getCurves({ years: 1 })).rejects.toThrow('down')
  })
})

describe('getCurves — 前進しない窓（API が to を無視する場合）', () => {
  it('does not loop forever when fetch always returns the same newest block, ignoring to', async () => {
    // レビュー指摘のトレースそのもの: fetchedAt が 1 年前で from=FROM_1Y, to=TODAY の
    // 直近窓を遡るときに、API が to を無視して常に同じ最新ブロックを返し続けるケース。
    const fetchedAt = Date.parse('2025-07-30T00:00:00Z') / 1000
    const store = fakeStore({ points: [curve('2026-07-29')], coveredFrom: FROM_1Y, fetchedAt })
    let calls = 0
    const fetch = vi.fn(async () => {
      calls++
      // 前進しなければ無限に呼ばれる。40 回を超えたら「止まっていない」ことにして
      // テストスイートをハングさせずに落とす。
      if (calls > 40) throw new Error('TreasuryCurveService did not terminate')
      return [curve('2026-05-01'), curve(TODAY)]
    })
    const r = await svc(store, fetch).getCurves({ years: 1 })

    expect(calls).toBeLessThan(40)
    expect(store.upsertCurves).not.toHaveBeenCalled()
    expect(r).toEqual({ points: [curve('2026-07-29')], coveredFrom: FROM_1Y, fetchedAt, stale: true })
  })
})

describe('getCurves — force（YC-05: 統計指標と逆）', () => {
  it('ignores the TTL but keeps history outside the refetched window', async () => {
    const store = fakeStore({
      points: [curve('2026-07-29', 1), curve('2020-01-02', 1)],
      coveredFrom: FROM_5Y,
      fetchedAt: T0
    })
    const fetch = vi.fn(async (_f: string, to: string) => [curve(to, 9)])
    const r = await svc(store, fetch).getCurves({ years: 1, force: true })

    // TTL 内でも直近窓を取り直す。行は捨てないので 5Y ぶんの履歴と coveredFrom は残る
    // （捨てると次の 5Y 表示で 22 本かかる）。
    expect(fetch).toHaveBeenCalledOnce()
    expect(r.coveredFrom).toBe(FROM_5Y)
    expect(r.points.some((p) => p.date === '2020-01-02')).toBe(true)
    expect(r.points.some((p) => p.date === TODAY)).toBe(true)
  })

  it('falls back to the existing row even under force', async () => {
    const store = fakeStore({ points: [curve(TODAY)], coveredFrom: FROM_1Y, fetchedAt: T0 })
    const fetch = vi.fn(async () => { throw new Error('down') })
    const r = await svc(store, fetch).getCurves({ years: 1, force: true })
    expect(r.stale).toBe(true)
    expect(store.upsertCurves).not.toHaveBeenCalled()
  })
})
