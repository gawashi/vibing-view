import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { readJsonFile, writeJsonFile } from './jsonStore'
import type { WatchlistItem, NamedWatchlist, Layout, Workspace, WorkspaceCollection } from '@shared/types'

const workspacesPath = (): string => join(app.getPath('userData'), 'workspaces.json')
const watchlistPath = (): string => join(app.getPath('userData'), 'watchlist.json')
const layoutsPath = (): string => join(app.getPath('userData'), 'layouts.json')

const DEFAULT_NAME = 'Workspace 1'
const LEGACY_DEFAULT_NAME = 'Watchlist'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

// renderer/workspace.ts の emptyLayout と同じ形（main からは import できないため複製）。
const emptyLayout = (): Layout => ({
  schemaVersion: 1,
  cells: [
    { id: '1', symbol: null, timeframe: '1d', indicators: [{ id: '2', type: 'volume', params: {}, colors: {}, visible: true, fixed: true }] }
  ],
  shape: '1x1',
  activeCellId: '1'
})

const defaultCollection = (): WorkspaceCollection => ({
  version: 3,
  active: DEFAULT_NAME,
  workspaces: [{ name: DEFAULT_NAME, items: [], layout: emptyLayout() }]
})

const isWellFormedItem = (v: unknown): v is WatchlistItem =>
  isRecord(v) && typeof v.symbol === 'string' && typeof v.name === 'string' && typeof v.exchange === 'string'

const isWorkspace = (v: unknown): v is Workspace =>
  isRecord(v) && typeof v.name === 'string' && Array.isArray(v.items) && isRecord(v.layout)

// 既存 v3 を検証（layout は不透明のまま。renderer の parseWorkspaceCollection が最終検証）。
function validateV3(raw: unknown): WorkspaceCollection | null {
  if (!isRecord(raw) || !Array.isArray(raw.workspaces)) return null
  const workspaces = raw.workspaces
    .filter(isWorkspace)
    .map((w) => ({ name: w.name, items: w.items.filter(isWellFormedItem), layout: w.layout }))
  if (workspaces.length === 0) return null
  const active = typeof raw.active === 'string' && workspaces.some((w) => w.name === raw.active) ? raw.active : workspaces[0].name
  return { version: 3, active, workspaces }
}

// 旧 watchlist.json を { active, lists } に正規化。無い/壊れている/空なら null。
function readLegacyWatchlists(): { active: string; lists: NamedWatchlist[] } | null {
  const raw = readJsonFile<unknown>(watchlistPath(), null)
  if (Array.isArray(raw)) {
    return { active: LEGACY_DEFAULT_NAME, lists: [{ name: LEGACY_DEFAULT_NAME, items: raw.filter(isWellFormedItem) }] }
  }
  if (isRecord(raw) && Array.isArray(raw.lists)) {
    const lists = (raw.lists as unknown[])
      .filter((l): l is NamedWatchlist => isRecord(l) && typeof l.name === 'string' && Array.isArray(l.items))
      .map((l) => ({ name: l.name, items: l.items.filter(isWellFormedItem) }))
    if (lists.length === 0) return null
    const active = typeof raw.active === 'string' && lists.some((l) => l.name === raw.active) ? raw.active : lists[0].name
    return { active, lists }
  }
  return null
}

function readLegacyCurrentLayout(): Layout | null {
  const raw = readJsonFile<{ current?: unknown }>(layoutsPath(), { current: null })
  return isRecord(raw) && isRecord(raw.current) ? (raw.current as Layout) : null
}

function migrateFromLegacy(): WorkspaceCollection | null {
  const legacy = readLegacyWatchlists()
  if (!legacy) return null
  const current = readLegacyCurrentLayout()
  const workspaces = legacy.lists.map((l) => ({
    name: l.name,
    items: l.items,
    layout: l.name === legacy.active && current ? current : emptyLayout()
  }))
  return { version: 3, active: legacy.active, workspaces }
}

export function getWorkspaces(): WorkspaceCollection {
  if (existsSync(workspacesPath())) {
    return validateV3(readJsonFile<unknown>(workspacesPath(), null)) ?? defaultCollection()
  }
  return migrateFromLegacy() ?? defaultCollection()
}

export function setWorkspaces(c: WorkspaceCollection): void {
  writeJsonFile(workspacesPath(), c)
}
