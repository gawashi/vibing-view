import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { readJsonFile, writeJsonFile } from './jsonStore'
import { emptyLayout, defaultWorkspaceCollection, parseWorkspaceCollection, isWatchlistItem } from '@shared/workspace'
import type { NamedWatchlist, Layout, WorkspaceCollection } from '@shared/types'

const workspacesPath = (): string => join(app.getPath('userData'), 'workspaces.json')
const watchlistPath = (): string => join(app.getPath('userData'), 'watchlist.json')
const layoutsPath = (): string => join(app.getPath('userData'), 'layouts.json')

const LEGACY_DEFAULT_NAME = 'Watchlist'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

// 旧 watchlist.json を { active, lists } に正規化。無い/壊れている/空なら null。
function readLegacyWatchlists(): { active: string; lists: NamedWatchlist[] } | null {
  const raw = readJsonFile<unknown>(watchlistPath(), null)
  if (Array.isArray(raw)) {
    return { active: LEGACY_DEFAULT_NAME, lists: [{ name: LEGACY_DEFAULT_NAME, items: raw.filter(isWatchlistItem) }] }
  }
  if (isRecord(raw) && Array.isArray(raw.lists)) {
    const lists = (raw.lists as unknown[])
      .filter((l): l is NamedWatchlist => isRecord(l) && typeof l.name === 'string' && Array.isArray(l.items))
      .map((l) => ({ name: l.name, items: l.items.filter(isWatchlistItem) }))
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
  // parseWorkspaceCollection (@shared) is the single trust boundary — it never throws and
  // normalizes malformed/legacy-shaped input (incl. the migrated collection) into a valid one.
  if (existsSync(workspacesPath())) {
    return parseWorkspaceCollection(readJsonFile<unknown>(workspacesPath(), null))
  }
  return parseWorkspaceCollection(migrateFromLegacy() ?? defaultWorkspaceCollection())
}

export function setWorkspaces(c: WorkspaceCollection): void {
  writeJsonFile(workspacesPath(), c)
}
