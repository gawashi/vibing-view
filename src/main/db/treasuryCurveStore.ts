import { eq } from 'drizzle-orm'
import type { TreasuryCurvePoint } from '@shared/types'
import { getDb } from './client'
import { treasuryCurves } from './schema'

// data 列は TreasuryCurvePoint[] の JSON blob。TTL 判定・窓の遡り・マージは
// TreasuryCurveService の責務で、ここは純粋な read/write のみ（economicIndicatorStore と同じ）。
export type TreasuryCurveRow = {
  points: TreasuryCurvePoint[]
  coveredFrom: string
  fetchedAt: number
}

export function getCurves(id: string): TreasuryCurveRow | null {
  const row = getDb().select().from(treasuryCurves)
    .where(eq(treasuryCurves.id, id)).get()
  return row
    ? {
        points: JSON.parse(row.data) as TreasuryCurvePoint[],
        coveredFrom: row.coveredFrom,
        fetchedAt: row.fetchedAt
      }
    : null
}

export function upsertCurves(
  id: string,
  points: TreasuryCurvePoint[],
  coveredFrom: string,
  fetchedAt: number
): void {
  const data = JSON.stringify(points)
  getDb().insert(treasuryCurves)
    .values({ id, data, coveredFrom, fetchedAt })
    .onConflictDoUpdate({
      target: treasuryCurves.id,
      set: { data, coveredFrom, fetchedAt }
    })
    .run()
}
