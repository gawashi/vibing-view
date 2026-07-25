import type { Cell, GridShape } from '@shared/types'
import { cellCount } from '@shared/workspace'

// Symbols that get a quote on reload: visible cells' symbols ∪ watchlist symbols, de-duped.
// Mirrors refreshTargets' visible-slice + watchlist union, but keyed by symbol only (quote is
// timeframe-agnostic). Order: visible cells first, then any new watchlist symbols.
export function quoteSymbols(cells: Cell[], shape: GridShape, watchlistSymbols: string[] = []): string[] {
  const seen = new Set<string>()
  for (const cell of cells.slice(0, cellCount(shape))) {
    if (cell.symbol) seen.add(cell.symbol)
  }
  for (const s of watchlistSymbols) seen.add(s)
  return [...seen]
}
