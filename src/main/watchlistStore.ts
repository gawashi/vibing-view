import { app } from 'electron'
import { join } from 'path'
import { readJsonFile, writeJsonFile } from './jsonStore'
import type { WatchlistItem } from '@shared/types'

// ponytail: same one-small-JSON-under-userData pattern as layoutStore.ts, SEPARATE file (D-62) so
// a corrupt watchlist.json can never touch layouts.json.
const watchlistPath = (): string => join(app.getPath('userData'), 'watchlist.json')

const isWellFormed = (item: unknown): item is WatchlistItem =>
  typeof item === 'object' &&
  item !== null &&
  typeof (item as WatchlistItem).symbol === 'string' &&
  typeof (item as WatchlistItem).name === 'string' &&
  typeof (item as WatchlistItem).exchange === 'string'

export function getWatchlist(): WatchlistItem[] {
  const raw = readJsonFile<unknown>(watchlistPath(), [])
  if (!Array.isArray(raw)) return []
  return raw.filter(isWellFormed)
}

export function setWatchlist(items: WatchlistItem[]): void {
  writeJsonFile(watchlistPath(), items)
}
