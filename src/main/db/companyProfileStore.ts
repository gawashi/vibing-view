import { eq } from 'drizzle-orm'
import type { CompanyProfileData } from '@shared/types'
import { getDb } from './client'
import { companyProfiles } from './schema'

// data 列は CompanyProfileData の JSON blob。fetchedAt は列で持ち、CompanyInfo への組み立ては
// CompanyInfoService 側で行う（ここは純粋な blob の read/write のみ）。
export function getCompanyProfile(symbol: string): { data: CompanyProfileData; fetchedAt: number } | null {
  const row = getDb().select().from(companyProfiles)
    .where(eq(companyProfiles.symbol, symbol)).get()
  return row ? { data: JSON.parse(row.data) as CompanyProfileData, fetchedAt: row.fetchedAt } : null
}

export function upsertCompanyProfile(symbol: string, data: CompanyProfileData, fetchedAt: number): void {
  const blob = JSON.stringify(data)
  getDb().insert(companyProfiles)
    .values({ symbol, data: blob, fetchedAt })
    .onConflictDoUpdate({
      target: companyProfiles.symbol,
      set: { data: blob, fetchedAt }
    })
    .run()
}
