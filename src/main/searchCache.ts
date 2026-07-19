import type { SymbolResult } from '@shared/types'

// ponytail: in-memory Map with TTL, cleared on process exit — no persistence needed (D-02)
export function createSearchCache(opts: { ttlMs: number; now: () => number }) {
  const { ttlMs, now } = opts
  const map = new Map<string, { at: number; results: SymbolResult[] }>()
  const key = (q: string) => q.trim().toLowerCase()
  return {
    get(query: string): SymbolResult[] | undefined {
      const hit = map.get(key(query))
      if (!hit) return undefined
      if (now() - hit.at >= ttlMs) {
        map.delete(key(query))
        return undefined
      }
      return hit.results
    },
    set(query: string, results: SymbolResult[]): void {
      map.set(key(query), { at: now(), results })
    }
  }
}
