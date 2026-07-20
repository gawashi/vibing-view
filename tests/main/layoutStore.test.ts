import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Workspace } from '@shared/types'

// ponytail: first precedent in this repo for mocking electron's `app` in Vitest (layoutStore is the
// first main-process module worth testing beyond pure logic) — a real temp dir under os.tmpdir()
// stands in for userData so writeJsonFile's atomic rename runs against a real filesystem.
let userDataDir: string

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

const layoutStore = await import('../../src/main/layoutStore')

const ws: Workspace = {
  schemaVersion: 1,
  cells: [{ id: 'c1', symbol: 'AAPL', timeframe: '1d', indicators: [] }],
  shape: '1x1',
  activeCellId: 'c1'
}

describe('layoutStore', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'layoutstore-test-'))
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('getCurrent returns null before anything is ever saved', () => {
    expect(layoutStore.getCurrent()).toBeNull()
  })

  it('round-trips a workspace through setCurrent → getCurrent', () => {
    layoutStore.setCurrent(ws)
    expect(layoutStore.getCurrent()).toEqual(ws)
  })

  it('leaves no residual .tmp file after a write', () => {
    layoutStore.setCurrent(ws)
    expect(existsSync(join(userDataDir, 'layouts.json.tmp'))).toBe(false)
    expect(existsSync(join(userDataDir, 'layouts.json'))).toBe(true)
  })

  it('falls back to null (never throws) when layouts.json is corrupt', () => {
    writeFileSync(join(userDataDir, 'layouts.json'), '{not valid json')
    expect(() => layoutStore.getCurrent()).not.toThrow()
    expect(layoutStore.getCurrent()).toBeNull()
  })

  it('listLayouts is empty before anything is ever saved', () => {
    expect(layoutStore.listLayouts()).toEqual([])
  })

  it('deleting one named layout leaves siblings and current intact', () => {
    const ws2: Workspace = { ...ws, activeCellId: 'c1', shape: '2x1' }
    layoutStore.setCurrent(ws)
    layoutStore.saveLayout('a', ws)
    layoutStore.saveLayout('b', ws2)

    layoutStore.deleteLayout('a')

    expect(layoutStore.listLayouts()).toEqual(['b'])
    expect(layoutStore.getLayout('b')).toEqual(ws2)
    expect(layoutStore.getLayout('a')).toBeNull()
    expect(layoutStore.getCurrent()).toEqual(ws)
  })

  it('saving the same name twice is an idempotent overwrite (one entry)', () => {
    const ws2: Workspace = { ...ws, shape: '2x1' }
    layoutStore.saveLayout('a', ws)
    layoutStore.saveLayout('a', ws2)

    expect(layoutStore.listLayouts()).toEqual(['a'])
    expect(layoutStore.getLayout('a')).toEqual(ws2)
  })

  it('renameLayout moves the key without disturbing siblings', () => {
    layoutStore.saveLayout('a', ws)
    layoutStore.saveLayout('b', ws)

    layoutStore.renameLayout('a', 'c')

    expect(layoutStore.listLayouts().sort()).toEqual(['b', 'c'])
    expect(layoutStore.getLayout('a')).toBeNull()
    expect(layoutStore.getLayout('c')).toEqual(ws)
  })

  it('leaves no residual .tmp file after a named-layout mutation', () => {
    layoutStore.saveLayout('a', ws)
    layoutStore.deleteLayout('a')
    expect(existsSync(join(userDataDir, 'layouts.json.tmp'))).toBe(false)
    expect(existsSync(join(userDataDir, 'layouts.json'))).toBe(true)
  })
})
