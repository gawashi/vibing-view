import { inArray } from 'drizzle-orm'
import type { EconomicEvent } from '@shared/types'
import { getDb } from './client'
import { economicDays } from './schema'

// data 列はその UTC 日の EconomicEvent[] の JSON blob。確定判定/欠け範囲の算出は
// EconomicCalendarService の責務で、ここは純粋な blob の read/write のみ（companyProfileStore と同じ）。
export type EconomicDayRow = { date: string; events: EconomicEvent[]; fetchedAt: number }

export function getDays(days: string[]): EconomicDayRow[] {
  if (days.length === 0) return []
  const rows = getDb().select().from(economicDays).where(inArray(economicDays.date, days)).all()
  return rows.map((r) => ({ date: r.date, events: JSON.parse(r.data) as EconomicEvent[], fetchedAt: r.fetchedAt }))
}

export function upsertDays(rows: EconomicDayRow[]): void {
  const db = getDb()
  for (const r of rows) {
    const blob = JSON.stringify(r.events)
    db.insert(economicDays)
      .values({ date: r.date, data: blob, fetchedAt: r.fetchedAt })
      .onConflictDoUpdate({ target: economicDays.date, set: { data: blob, fetchedAt: r.fetchedAt } })
      .run()
  }
}
