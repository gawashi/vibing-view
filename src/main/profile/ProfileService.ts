import type { SymbolResult } from '@shared/types'

export function createProfileService(deps: {
  store: {
    getProfile(symbol: string): SymbolResult | null
    upsertProfile(p: SymbolResult): void
  }
  search: (query: string) => Promise<SymbolResult[]>
}) {
  const { store, search } = deps
  return {
    async getProfile(symbol: string): Promise<SymbolResult> {
      const cached = store.getProfile(symbol)
      if (cached) return cached

      let results: SymbolResult[]
      try {
        results = await search(symbol)
      } catch {
        // Transient failure (no API key / network / HTTP error) — return a fallback but do NOT
        // cache it, so a later successful resolve (e.g. after the key is added) refetches.
        return { symbol, name: symbol, exchange: '' }
      }

      const match = results.find((r) => r.symbol.toLowerCase() === symbol.toLowerCase())
      const resolved: SymbolResult = match ?? { symbol, name: symbol, exchange: '' }
      store.upsertProfile(resolved)
      return resolved
    }
  }
}
