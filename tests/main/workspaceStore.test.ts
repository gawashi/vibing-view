import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Layout, WorkspaceCollection } from '@shared/types'

let userDataDir: string
vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }))

const store = await import('../../src/main/workspaceStore')

const aapl = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }
const msft = { symbol: 'MSFT', name: 'Microsoft Corp.', exchange: 'NASDAQ' }
const layoutL: Layout = { schemaVersion: 1, cells: [{ id: 'c1', symbol: 'AAPL', timeframe: '1d', indicators: [] }], shape: { rows: 1, cols: 1 }, activeCellId: 'c1' }
const layoutL2: Layout = { schemaVersion: 1, cells: [{ id: 'c2', symbol: 'AAPL', timeframe: '1d', indicators: [] }], shape: { rows: 1, cols: 1 }, activeCellId: 'c2' }

describe('workspaceStore', () => {
  beforeEach(() => { userDataDir = mkdtempSync(join(tmpdir(), 'wsstore-test-')) })
  afterEach(() => { rmSync(userDataDir, { recursive: true, force: true }) })

  it('returns a default single "Workspace 1" on a clean install', () => {
    const c = store.getWorkspaces()
    expect(c.active).toBe('Workspace 1')
    expect(c.workspaces.map((w) => w.name)).toEqual(['Workspace 1'])
    expect(c.workspaces[0].items).toEqual([])
    expect(c.workspaces[0].layout.cells[0].symbol).toBeNull()
  })

  it('round-trips a v3 collection through set → get', () => {
    const c: WorkspaceCollection = {
      version: 3,
      active: 'Scan',
      workspaces: [
        { name: 'Main', items: [aapl], layout: layoutL },
        { name: 'Scan', items: [], layout: layoutL2 }
      ]
    }
    store.setWorkspaces(c)
    expect(store.getWorkspaces()).toEqual(c)
  })

  it('migrates legacy watchlist.json (v2) + layouts.json: active list carries the current layout, others default', () => {
    writeFileSync(join(userDataDir, 'watchlist.json'), JSON.stringify({
      version: 2, active: 'Tech',
      lists: [{ name: 'Watchlist', items: [aapl] }, { name: 'Tech', items: [msft] }]
    }))
    writeFileSync(join(userDataDir, 'layouts.json'), JSON.stringify({ current: layoutL, named: {} }))

    const c = store.getWorkspaces()
    expect(c.active).toBe('Tech')
    expect(c.workspaces.map((w) => w.name)).toEqual(['Watchlist', 'Tech'])
    expect(c.workspaces.find((w) => w.name === 'Tech')!.layout).toEqual(layoutL)
    expect(c.workspaces.find((w) => w.name === 'Tech')!.items).toEqual([msft])
    // non-active list gets the empty default layout
    expect(c.workspaces.find((w) => w.name === 'Watchlist')!.layout.cells[0].symbol).toBeNull()
  })

  it('migrates an old flat-array watchlist.json into the active default workspace', () => {
    writeFileSync(join(userDataDir, 'watchlist.json'), JSON.stringify([aapl, msft]))
    writeFileSync(join(userDataDir, 'layouts.json'), JSON.stringify({ current: layoutL, named: {} }))
    const c = store.getWorkspaces()
    expect(c.workspaces).toHaveLength(1)
    expect(c.workspaces[0].name).toBe('Watchlist')
    expect(c.workspaces[0].items).toEqual([aapl, msft])
    expect(c.workspaces[0].layout).toEqual(layoutL)
  })

  it('does NOT re-migrate once workspaces.json exists (even if legacy files remain)', () => {
    store.setWorkspaces({ version: 3, active: 'Kept', workspaces: [{ name: 'Kept', items: [], layout: layoutL }] })
    writeFileSync(join(userDataDir, 'watchlist.json'), JSON.stringify({ version: 2, active: 'Old', lists: [{ name: 'Old', items: [aapl] }] }))
    expect(store.getWorkspaces().workspaces.map((w) => w.name)).toEqual(['Kept'])
  })

  it('falls back to default (not migration) when an existing workspaces.json is corrupt', () => {
    writeFileSync(join(userDataDir, 'workspaces.json'), '{not valid json')
    writeFileSync(join(userDataDir, 'watchlist.json'), JSON.stringify({ version: 2, active: 'Old', lists: [{ name: 'Old', items: [aapl] }] }))
    expect(() => store.getWorkspaces()).not.toThrow()
    expect(store.getWorkspaces().workspaces.map((w) => w.name)).toEqual(['Workspace 1'])
  })
})
