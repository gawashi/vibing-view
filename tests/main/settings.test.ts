import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
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

describe('settings mcp', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'settings-test-'))
  })
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('defaults to disabled with no token', () => {
    expect(settings.getMcpConfig()).toEqual({ enabled: false, port: 39100, token: '' })
  })

  // Reading the config used to mint and persist a token as a side effect. It must not: a fresh
  // profile has no credential until the user asks for one.
  it('does not write settings.json when the config is only read', () => {
    settings.getMcpConfig()
    settings.getMcpConfigView()
    expect(existsSync(join(userDataDir, 'settings.json'))).toBe(false)
  })

  it('does not mint a token when enabling or changing the port', () => {
    settings.setMcpConfig({ enabled: true })
    settings.setMcpConfig({ port: 40000 })
    expect(settings.getMcpConfig()).toEqual({ enabled: true, port: 40000, token: '' })
  })

  it('mints and persists a 43-char base64url token on request', () => {
    const first = settings.generateMcpToken().token
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(settings.getMcpConfig().token).toBe(first)
    expect(settings.generateMcpToken().token).not.toBe(first)
  })

  it('keeps unrelated settings when generating a token', () => {
    settings.setTheme('dark')
    settings.generateMcpToken()
    expect(settings.getTheme()).toBe('dark')
  })

  it('masks a token to its own length, showing the last 4 chars', () => {
    const token = settings.generateMcpToken().token
    const masked = settings.getMcpConfigView().maskedToken
    expect(masked).toHaveLength(token.length)
    expect(masked).toBe('*'.repeat(39) + token.slice(-4))
  })

  it('masks short and empty tokens whole rather than exposing them', () => {
    expect(settings.maskMcpToken('')).toBe('')
    expect(settings.maskMcpToken('abc')).toBe('***')
    expect(settings.maskMcpToken('abcd')).toBe('****')
    expect(settings.maskMcpToken('abcde')).toBe('*bcde')
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

describe('settings economicFilter', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'settings-test-'))
  })
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it("defaults to US only + High/Medium before anything is saved", () => {
    expect(settings.getEconomicFilter()).toEqual({ countries: 'us', impacts: ['High', 'Medium'] })
  })

  it('round-trips through set → get', () => {
    settings.setEconomicFilter({ countries: 'major', impacts: ['Low'] })
    expect(settings.getEconomicFilter()).toEqual({ countries: 'major', impacts: ['Low'] })
  })

  // 全トグル off はユーザーの正当な状態。既定に巻き戻してはいけない。
  it('preserves an empty impacts array', () => {
    settings.setEconomicFilter({ countries: 'all', impacts: [] })
    expect(settings.getEconomicFilter()).toEqual({ countries: 'all', impacts: [] })
  })

  it('falls back on a hand-edited / corrupt value instead of throwing', () => {
    settings.setEconomicFilter({ countries: 'bogus' as never, impacts: ['High', 'Nope' as never] })
    expect(settings.getEconomicFilter()).toEqual({ countries: 'us', impacts: ['High'] })
  })

  it('does not clobber theme when writing the filter', () => {
    settings.setTheme('dark')
    settings.setEconomicFilter({ countries: 'all', impacts: ['High'] })
    expect(settings.getTheme()).toBe('dark')
    expect(settings.getEconomicFilter().countries).toBe('all')
  })
})
