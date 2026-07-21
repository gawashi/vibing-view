import { eq } from 'drizzle-orm'
import type { SymbolResult } from '@shared/types'
import { getDb } from './client'
import { symbolProfiles } from './schema'

export function getProfile(symbol: string): SymbolResult | null {
  const row = getDb().select().from(symbolProfiles)
    .where(eq(symbolProfiles.symbol, symbol)).get()
  return row ? { symbol: row.symbol, name: row.name, exchange: row.exchange } : null
}

export function upsertProfile(p: SymbolResult): void {
  getDb().insert(symbolProfiles)
    .values({ symbol: p.symbol, name: p.name, exchange: p.exchange })
    .onConflictDoUpdate({
      target: symbolProfiles.symbol,
      set: { name: p.name, exchange: p.exchange }
    })
    .run()
}
