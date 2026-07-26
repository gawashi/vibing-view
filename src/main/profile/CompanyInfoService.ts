import type { CompanyInfo, CompanyProfileData } from '@shared/types'

// TTL = 1 day. Fresh row → cache hit (no network). Stale/missing → provider fetch + upsert.
// Fetch fails but a stale row exists → return stale (better than an empty dialog); no row → rethrow.
const TTL_SECONDS = 86400

export function createCompanyInfoService(deps: {
  store: {
    getCompanyProfile(symbol: string): { data: CompanyProfileData; fetchedAt: number } | null
    upsertCompanyProfile(symbol: string, data: CompanyProfileData, fetchedAt: number): void
  }
  fetch: (symbol: string) => Promise<CompanyProfileData>
  now?: () => number // epoch seconds — injectable for tests
}) {
  const { store, fetch } = deps
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))
  return {
    async getInfo(symbol: string, opts?: { force?: boolean }): Promise<CompanyInfo> {
      const cached = store.getCompanyProfile(symbol)
      if (!opts?.force && cached && now() - cached.fetchedAt < TTL_SECONDS) {
        return { ...cached.data, fetchedAt: cached.fetchedAt }
      }
      try {
        const data = await fetch(symbol)
        const fetchedAt = now()
        store.upsertCompanyProfile(symbol, data, fetchedAt)
        return { ...data, fetchedAt }
      } catch (err) {
        // stale: true so callers can say "this is the cached row, the refetch failed" — fetchedAt
        // alone can't tell them (a row written seconds ago still looks fresh).
        if (cached) return { ...cached.data, fetchedAt: cached.fetchedAt, stale: true }
        throw err
      }
    }
  }
}
