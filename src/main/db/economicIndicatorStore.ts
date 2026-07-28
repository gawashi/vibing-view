import { eq } from 'drizzle-orm'
import type { EconomicIndicatorPoint } from '@shared/types'
import { getDb } from './client'
import { economicIndicators } from './schema'

// data 列は EconomicIndicatorPoint[] の JSON blob。TTL 判定・遡り・マージは
// EconomicIndicatorService の責務で、ここは純粋な read/write のみ（companyProfileStore と同じ）。
export type EconomicIndicatorRow = {
  points: EconomicIndicatorPoint[]
  coveredFrom: string
  fetchedAt: number
}

export function getIndicator(name: string): EconomicIndicatorRow | null {
  const row = getDb().select().from(economicIndicators)
    .where(eq(economicIndicators.name, name)).get()
  return row
    ? {
        points: JSON.parse(row.data) as EconomicIndicatorPoint[],
        coveredFrom: row.coveredFrom,
        fetchedAt: row.fetchedAt
      }
    : null
}

export function upsertIndicator(
  name: string,
  points: EconomicIndicatorPoint[],
  coveredFrom: string,
  fetchedAt: number
): void {
  const data = JSON.stringify(points)
  getDb().insert(economicIndicators)
    .values({ name, data, coveredFrom, fetchedAt })
    .onConflictDoUpdate({
      target: economicIndicators.name,
      set: { data, coveredFrom, fetchedAt }
    })
    .run()
}
