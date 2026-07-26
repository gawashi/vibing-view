import { describe, it, expect, vi } from 'vitest'
import { createCore, type CoreDeps } from '../../../src/main/core'
import type { WorkspaceCollection } from '@shared/types'

const collection = (active = 'Main'): WorkspaceCollection => ({
  version: 3,
  active,
  workspaces: [{
    name: 'Main', items: [],
    layout: {
      schemaVersion: 1, shape: { rows: 1, cols: 1 }, activeCellId: '1',
      cells: [{ id: '1', symbol: null, timeframe: '1d', indicators: [] }]
    }
  }]
})

function build(initial = collection()) {
  let stored = initial
  const broadcast = vi.fn()
  const setWorkspaces = vi.fn((c: WorkspaceCollection) => { stored = c })
  const deps = {
    broadcast,
    barStore: {} as CoreDeps['barStore'],
    profileStore: {} as CoreDeps['profileStore'],
    companyProfileStore: {} as CoreDeps['companyProfileStore'],
    workspaceStore: { getWorkspaces: () => stored, setWorkspaces },
    capabilityCache: {} as CoreDeps['capabilityCache'],
    keystore: {} as CoreDeps['keystore'],
    makeProvider: () => ({}) as ReturnType<CoreDeps['makeProvider']>
  } as CoreDeps
  return { core: createCore(deps), broadcast, setWorkspaces, read: () => stored }
}

describe('core.workspaces.mutate', () => {
  it('writes, bumps rev by one, and broadcasts to every window', () => {
    const { core, broadcast, setWorkspaces } = build()
    const before = core.workspaces.get().rev
    const res = core.workspaces.mutate((c) => ({
      ok: true, collection: { ...c, active: 'Main' }, value: 'done'
    }))
    expect(res).toMatchObject({ ok: true, value: 'done' })
    expect(setWorkspaces).toHaveBeenCalledTimes(1)
    expect(core.workspaces.get().rev).toBe(before + 1)
    // No fromWebContentsId: MCP is not a window, so every window must re-hydrate.
    expect(broadcast).toHaveBeenCalledWith('workspaces:changed', expect.anything(), undefined)
  })

  it('passes the CURRENT persisted collection to the editor', () => {
    const { core } = build()
    core.workspaces.mutate((c) => ({ ok: true, collection: { ...c, active: 'Main' }, value: null }))
    const seen: string[] = []
    core.workspaces.mutate((c) => {
      seen.push(c.workspaces[0].name)
      return { ok: true, collection: c, value: null }
    })
    expect(seen).toEqual(['Main'])
  })

  it('writes nothing when the editor fails', () => {
    const { core, broadcast, setWorkspaces } = build()
    const before = core.workspaces.get().rev
    const res = core.workspaces.mutate(() => ({ ok: false as const, message: 'nope' }))
    expect(res).toEqual({ ok: false, message: 'nope' })
    expect(setWorkspaces).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
    expect(core.workspaces.get().rev).toBe(before)
  })

  it('returns the written collection so callers can format the new state', () => {
    const { core } = build()
    const res = core.workspaces.mutate((c) => ({
      ok: true, collection: { ...c, workspaces: [{ ...c.workspaces[0], name: 'Renamed' }], active: 'Renamed' }, value: 1
    }))
    if (!res.ok) throw new Error(res.message)
    expect(res.collection.workspaces[0].name).toBe('Renamed')
  })
})
