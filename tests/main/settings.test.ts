import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let userDataDir: string

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

const settings = await import('../../src/main/settings')

describe('settings sidebar width', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'settings-test-'))
  })
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns null before anything is saved', () => {
    expect(settings.getSidebarWidth()).toBeNull()
  })

  it('round-trips a width through set → get', () => {
    settings.setSidebarWidth(360)
    expect(settings.getSidebarWidth()).toBe(360)
  })

  it('does not clobber sidebarOpen when writing width', () => {
    settings.setSidebarOpen(false)
    settings.setSidebarWidth(360)
    expect(settings.getSidebarOpen()).toBe(false)
    expect(settings.getSidebarWidth()).toBe(360)
  })
})
