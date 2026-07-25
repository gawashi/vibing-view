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

describe('settings theme', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'settings-test-'))
  })
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it("defaults to 'system' before anything is saved", () => {
    expect(settings.getTheme()).toBe('system')
  })

  it('round-trips a theme through set → get', () => {
    settings.setTheme('dark')
    expect(settings.getTheme()).toBe('dark')
  })

  it('does not clobber sidebarWidth when writing theme', () => {
    settings.setSidebarWidth(360)
    settings.setTheme('light')
    expect(settings.getSidebarWidth()).toBe(360)
    expect(settings.getTheme()).toBe('light')
  })
})

describe('settings autoRefresh', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'settings-test-'))
  })
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('defaults to false before anything is saved', () => {
    expect(settings.getAutoRefresh()).toBe(false)
  })

  it('round-trips through set → get', () => {
    settings.setAutoRefresh(true)
    expect(settings.getAutoRefresh()).toBe(true)
  })

  it('does not clobber theme when writing autoRefresh', () => {
    settings.setTheme('dark')
    settings.setAutoRefresh(true)
    expect(settings.getTheme()).toBe('dark')
    expect(settings.getAutoRefresh()).toBe(true)
  })
})
