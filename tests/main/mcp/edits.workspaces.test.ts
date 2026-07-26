import { describe, it, expect } from 'vitest'
import {
  activateWorkspace, createWorkspace, deleteWorkspace, editWatchlist, renameWorkspace
} from '../../../src/main/mcp/edits'
import type { WatchlistItem, WorkspaceCollection } from '@shared/types'

const item = (symbol: string): WatchlistItem => ({ symbol, name: `${symbol} Inc.`, exchange: 'NASDAQ' })

const collection = (): WorkspaceCollection => ({
  version: 3,
  active: 'Main',
  workspaces: [
    {
      name: 'Main',
      items: [item('NVDA')],
      layout: {
        schemaVersion: 1, shape: { rows: 1, cols: 1 }, activeCellId: '1',
        cells: [{
          id: '1', symbol: 'NVDA', timeframe: '1d',
          indicators: [{ id: '2', type: 'volume', params: {}, colors: {}, visible: true, fixed: true }]
        }]
      }
    },
    {
      name: 'Other',
      items: [],
      layout: {
        schemaVersion: 1, shape: { rows: 1, cols: 1 }, activeCellId: '3',
        cells: [{ id: '3', symbol: null, timeframe: '1d', indicators: [] }]
      }
    }
  ]
})

describe('editWatchlist', () => {
  it('adds and removes in one pass', () => {
    const res = editWatchlist(collection(), { add: [item('AMD')], remove: ['NVDA'] })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.items.map((i) => i.symbol)).toEqual(['AMD'])
    expect(res.value).toMatchObject({ addedCount: 1, removedCount: 1 })
  })

  // Parity with addToWatchlist: adding a symbol that is already there is a no-op, not an error.
  it('ignores a duplicate add', () => {
    const res = editWatchlist(collection(), { add: [item('NVDA')], remove: [] })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.items.map((i) => i.symbol)).toEqual(['NVDA'])
    expect(res.value.addedCount).toBe(0)
  })

  it('adds a ticker repeated within one batch only once', () => {
    const res = editWatchlist(collection(), { add: [item('AMD'), item('amd')], remove: [] })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.items.map((i) => i.symbol)).toEqual(['NVDA', 'AMD'])
    expect(res.value.addedCount).toBe(1)
  })

  it('ignores a remove for a symbol that is not on the list', () => {
    const res = editWatchlist(collection(), { add: [], remove: ['TSLA'] })
    if (!res.ok) throw new Error(res.message)
    expect(res.value.removedCount).toBe(0)
  })
})

describe('createWorkspace', () => {
  it('creates an empty workspace and activates it by default', () => {
    const res = createWorkspace(collection(), { name: 'Fresh', activate: true })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces.map((w) => w.name)).toEqual(['Main', 'Other', 'Fresh'])
    expect(res.collection.active).toBe('Fresh')
    const created = res.collection.workspaces[2]
    expect(created.items).toEqual([])
    expect(created.layout.cells).toHaveLength(1)
  })

  it('can create without switching to it', () => {
    const res = createWorkspace(collection(), { name: 'Fresh', activate: false })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.active).toBe('Main')
  })

  // Ids must be collection-wide unique, so a copy re-mints every cell and indicator id.
  it('copies a workspace with fresh ids', () => {
    const res = createWorkspace(collection(), { name: 'Copy', copyFrom: 'Main', activate: false })
    if (!res.ok) throw new Error(res.message)
    const copy = res.collection.workspaces.find((w) => w.name === 'Copy')!
    expect(copy.items.map((i) => i.symbol)).toEqual(['NVDA'])
    expect(copy.layout.cells[0].id).toBe('4')
    expect(copy.layout.cells[0].indicators[0].id).toBe('5')
    expect(copy.layout.activeCellId).toBe('4')
    expect(copy.layout.cells[0].symbol).toBe('NVDA')
  })

  it('rejects a duplicate name', () => {
    expect(createWorkspace(collection(), { name: 'Other', activate: true })).toEqual({
      ok: false, message: 'A workspace named "Other" already exists.'
    })
  })

  it('rejects an unknown copyFrom', () => {
    expect(createWorkspace(collection(), { name: 'Copy', copyFrom: 'Nope', activate: true })).toEqual({
      ok: false, message: 'No workspace named "Nope". Available: Main, Other'
    })
  })
})

describe('renameWorkspace', () => {
  it('renames and follows the active pointer', () => {
    const res = renameWorkspace(collection(), { from: 'Main', to: 'Primary' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces.map((w) => w.name)).toEqual(['Primary', 'Other'])
    expect(res.collection.active).toBe('Primary')
  })

  it('rejects a duplicate target name', () => {
    expect(renameWorkspace(collection(), { from: 'Main', to: 'Other' })).toEqual({
      ok: false, message: 'A workspace named "Other" already exists.'
    })
  })

  it('rejects an unknown source name', () => {
    expect(renameWorkspace(collection(), { from: 'Nope', to: 'X' })).toEqual({
      ok: false, message: 'No workspace named "Nope". Available: Main, Other'
    })
  })
})

describe('deleteWorkspace', () => {
  it('deletes and reports what was lost', () => {
    const res = deleteWorkspace(collection(), { name: 'Main' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces.map((w) => w.name)).toEqual(['Other'])
    expect(res.value).toEqual({
      name: 'Main', cellCount: 1, symbols: ['NVDA'], watchlistCount: 1, activeNow: 'Other'
    })
  })

  it('moves active to the first survivor when the active one goes', () => {
    const res = deleteWorkspace(collection(), { name: 'Main' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.active).toBe('Other')
  })

  it('leaves active alone when another workspace goes', () => {
    const res = deleteWorkspace(collection(), { name: 'Other' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.active).toBe('Main')
  })

  it('refuses to delete the only workspace', () => {
    const c = collection()
    c.workspaces = [c.workspaces[0]]
    expect(deleteWorkspace(c, { name: 'Main' })).toEqual({
      ok: false, message: 'Cannot delete the only workspace.'
    })
  })

  it('rejects an unknown name', () => {
    expect(deleteWorkspace(collection(), { name: 'Nope' })).toEqual({
      ok: false, message: 'No workspace named "Nope". Available: Main, Other'
    })
  })
})

describe('activateWorkspace', () => {
  it('switches the active pointer', () => {
    const res = activateWorkspace(collection(), { name: 'Other' })
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.active).toBe('Other')
  })

  it('rejects an unknown name', () => {
    expect(activateWorkspace(collection(), { name: 'Nope' })).toEqual({
      ok: false, message: 'No workspace named "Nope". Available: Main, Other'
    })
  })
})
