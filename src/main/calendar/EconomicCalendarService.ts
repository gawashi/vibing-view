import type { EconomicEvent, EconomicRange } from '@shared/types'

// その日の翌 00:00 UTC 以降に取得した行は確定 — 以後フェッチしない。それ以外は TTL 3600 秒（EC-06）。
// 「過去日は永続」では穴が空く: 金曜 10:00 UTC に取った金曜の行は 13:30 UTC 発表分の actual が
// null のまま固定されてしまう。条件は取得時刻で切る。
const TTL_SECONDS = 3600

export type EconomicDayRow = { date: string; events: EconomicEvent[]; fetchedAt: number }

const utcYmd = (epochSeconds: number): string => new Date(epochSeconds * 1000).toISOString().slice(0, 10)
const dayStart = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 1000

// from..to（両端含む）の UTC 日を昇順で列挙。
function enumerateDays(from: string, to: string): string[] {
  const days: string[] = []
  for (let t = dayStart(from), end = dayStart(to); t <= end; t += 86400) days.push(utcYmd(t))
  return days
}

export function createEconomicCalendarService(deps: {
  store: {
    getDays(days: string[]): EconomicDayRow[]
    upsertDays(rows: EconomicDayRow[]): void
  }
  fetch: (from: string, to: string) => Promise<EconomicEvent[]>
  now?: () => number // epoch seconds — injectable for tests
}) {
  const { store, fetch } = deps
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))

  const isFresh = (row: EconomicDayRow): boolean =>
    row.fetchedAt >= dayStart(row.date) + 86400 || now() - row.fetchedAt < TTL_SECONDS

  // 要求した日の行を 1 本にまとめる。fetchedAt は最も古い取得時刻（一番古い情報がいつのものか）。
  const collect = (days: string[], cached: Map<string, EconomicDayRow>): EconomicRange => {
    const rows = days.map((d) => cached.get(d)!)
    return {
      events: rows.flatMap((r) => r.events).sort((a, b) => a.time - b.time),
      fetchedAt: Math.min(...rows.map((r) => r.fetchedAt))
    }
  }

  return {
    async getRange(from: string, to: string, opts?: { force?: boolean }): Promise<EconomicRange> {
      const days = enumerateDays(from, to)
      const cached = new Map(store.getDays(days).map((r) => [r.date, r]))
      // force は確定/TTL を無視して必要日を全部取り直す（company.info と同じ）。
      const missing = opts?.force ? days : days.filter((d) => {
        const row = cached.get(d)
        return !row || !isFresh(row)
      })

      if (missing.length > 0) {
        // 欠け日が飛んでいても min..max の 1 リクエストに畳む（EC-07）。範囲内の fresh な日も
        // 上書きされるが、新しいデータなので無害。
        const lo = missing[0]
        const hi = missing[missing.length - 1]
        try {
          const events = await fetch(lo, hi)
          const fetchedAt = now()
          // 要求範囲の全日に行を書く。返ってこなかった日は '[]'（EC-08）— 省くと土日祝が毎回ミス
          // 判定になり、その週を開くたびに API を空撃ちする。
          const byDay = new Map(enumerateDays(lo, hi).map((d) => [d, [] as EconomicEvent[]]))
          for (const e of events) byDay.get(utcYmd(e.time))?.push(e) // 範囲外の日は捨てる
          const rows = [...byDay].map(([date, evs]) => ({ date, events: evs, fetchedAt }))
          store.upsertDays(rows)
          for (const r of rows) cached.set(r.date, r)
        } catch (err) {
          // EC-18: stale で返すのは要求した全日に行があるときだけ。1 日でも無ければ throw する
          // （'[]' の行は「その日は発表なし」なので、行があるとみなす）。混在状態を部分的に返すと
          // 「発表が無い」と「取れなかった」が UI で区別できず、欠けが空に見える。
          if (days.some((d) => !cached.has(d))) throw err
          return { ...collect(days, cached), stale: true }
        }
      }

      return collect(days, cached)
    }
  }
}
