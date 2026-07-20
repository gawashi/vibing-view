import { app } from 'electron'
import { join } from 'path'
import { readJsonFile, writeJsonFile } from './jsonStore'
import type { WatchlistItem, NamedWatchlist, WatchlistCollection } from '@shared/types'

// ponytail: layoutStore と同じ「userData 下の小さな JSON」パターン、SEPARATE file (D-62)。
const watchlistPath = (): string => join(app.getPath('userData'), 'watchlist.json')

const DEFAULT_NAME = 'Watchlist'
const defaultCollection = (): WatchlistCollection => ({
  version: 2,
  active: DEFAULT_NAME,
  lists: [{ name: DEFAULT_NAME, items: [] }]
})

const isWellFormed = (item: unknown): item is WatchlistItem =>
  typeof item === 'object' &&
  item !== null &&
  typeof (item as WatchlistItem).symbol === 'string' &&
  typeof (item as WatchlistItem).name === 'string' &&
  typeof (item as WatchlistItem).exchange === 'string'

const isNamedList = (v: unknown): v is NamedWatchlist =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as NamedWatchlist).name === 'string' &&
  Array.isArray((v as NamedWatchlist).items)

export function getWatchlists(): WatchlistCollection {
  const raw = readJsonFile<unknown>(watchlistPath(), null)

  // 旧形式（フラット配列）→ デフォルトリストへ移行。
  if (Array.isArray(raw)) {
    return { version: 2, active: DEFAULT_NAME, lists: [{ name: DEFAULT_NAME, items: raw.filter(isWellFormed) }] }
  }

  // v2 コレクション。壊れた要素は落とし、空なら既定へ。
  if (typeof raw === 'object' && raw !== null && Array.isArray((raw as WatchlistCollection).lists)) {
    const lists = (raw as WatchlistCollection).lists
      .filter(isNamedList)
      .map((l) => ({ name: l.name, items: l.items.filter(isWellFormed) }))
    if (lists.length === 0) return defaultCollection()
    const storedActive = (raw as WatchlistCollection).active
    const active = lists.some((l) => l.name === storedActive) ? storedActive : lists[0].name
    return { version: 2, active, lists }
  }

  return defaultCollection()
}

export function setWatchlists(c: WatchlistCollection): void {
  writeJsonFile(watchlistPath(), c)
}
