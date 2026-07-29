import { describe, it, expect, vi } from 'vitest'
import { createCore, type CoreDeps } from '../../../src/main/core'
import { FmpHttpError } from '../../../src/main/providers/FmpProvider'
import type { WorkspaceCollection } from '@shared/types'

const collection = (name: string): WorkspaceCollection => ({
  version: 3,
  active: name,
  workspaces: [{ name, items: [], layout: { schemaVersion: 1, cells: [], shape: { rows: 1, cols: 1 }, activeCellId: '1' } }]
})

// 2026-07-27 (Mon) 一日ぶんを要求範囲に使う。
const FROM = '2026-07-27'
const TO = '2026-07-27'

function deps(getEconomicCalendar: ReturnType<typeof vi.fn>, over: Partial<CoreDeps> = {}): CoreDeps {
  const base: CoreDeps = {
    broadcast: vi.fn(),
    barStore: {
      getCoverage: vi.fn(() => null),
      getBars: vi.fn(() => []),
      upsertBarsAndCoverage: vi.fn(),
      summarizeBars: vi.fn(() => [])
    },
    profileStore: { getProfile: vi.fn(() => null), upsertProfile: vi.fn() },
    companyProfileStore: { getCompanyProfile: vi.fn(() => null), upsertCompanyProfile: vi.fn() },
    economicDayStore: { getDays: vi.fn(() => []), upsertDays: vi.fn() },
    economicIndicatorStore: { getIndicator: vi.fn(() => null), upsertIndicator: vi.fn() },
    workspaceStore: { getWorkspaces: vi.fn(() => collection('W')), setWorkspaces: vi.fn() },
    capabilityCache: { getStatus: vi.fn(() => 'unknown' as const), setStatus: vi.fn(), clearForKeyChange: vi.fn() },
    keystore: {
      getApiKey: vi.fn(() => 'KEY'),
      setApiKey: vi.fn(() => ({ ok: true, encryptionAvailable: true })),
      getKeyStatus: vi.fn(() => ({ hasKey: true, encryptionAvailable: true })),
      clearApiKey: vi.fn()
    },
    makeProvider: vi.fn(() => ({
      getOHLCV: vi.fn(async () => []),
      searchSymbols: vi.fn(async () => []),
      getQuote: vi.fn(),
      getMarketStatus: vi.fn(),
      getCompanyProfile: vi.fn(),
      getEconomicCalendar,
      getEconomicIndicator: vi.fn(async () => [])
    })),
    nowSec: () => 1_000
  }
  return { ...base, ...over }
}

describe('core.economicCalendar.getRange', () => {
  it('reaches the provider and returns the normalized range', async () => {
    const getEconomicCalendar = vi.fn(async () => [{
      time: Date.parse('2026-07-27T12:30:00Z') / 1000,
      country: 'US', currency: 'USD', event: 'CPI MoM', impact: 'High' as const,
      previous: 0.2, estimate: 0.3, actual: 0.3
    }])
    const d = deps(getEconomicCalendar)
    const core = createCore(d)
    const r = await core.economicCalendar.getRange(FROM, TO)
    expect(getEconomicCalendar).toHaveBeenCalledExactlyOnceWith(FROM, TO)
    expect(r.events.map((e) => e.event)).toEqual(['CPI MoM'])
    expect(d.economicDayStore.getDays).toHaveBeenCalledWith(['2026-07-27'])
  })

  it('throws NO_API_KEY without a key, without building a provider', async () => {
    const getEconomicCalendar = vi.fn()
    const d = deps(getEconomicCalendar)
    d.keystore.getApiKey = vi.fn(() => null)
    await expect(createCore(d).economicCalendar.getRange(FROM, TO)).rejects.toThrow('NO_API_KEY')
    expect(getEconomicCalendar).not.toHaveBeenCalled()
    expect(d.makeProvider).not.toHaveBeenCalled()
  })
})

describe('core.economicCalendar — off-plan short-circuit (EC-15)', () => {
  it.each([402, 403])('stops hitting the network after a %i and rethrows the same error', async (status) => {
    const err = new FmpHttpError(status, { 'Error Message': 'Exclusive Endpoint' })
    const getEconomicCalendar = vi.fn(async () => { throw err })
    const d = deps(getEconomicCalendar)
    const core = createCore(d)

    await expect(core.economicCalendar.getRange(FROM, TO)).rejects.toBe(err)
    await expect(core.economicCalendar.getRange('2026-08-03', '2026-08-03')).rejects.toBe(err)
    expect(getEconomicCalendar).toHaveBeenCalledOnce() // 2 度目はネットワークに出ない
    expect(d.makeProvider).toHaveBeenCalledOnce() // latched call must not construct a provider
  })

  it('does not latch on a 429 (transient)', async () => {
    const getEconomicCalendar = vi.fn(async () => { throw new FmpHttpError(429, null) })
    const core = createCore(deps(getEconomicCalendar))
    await expect(core.economicCalendar.getRange(FROM, TO)).rejects.toBeInstanceOf(FmpHttpError)
    await expect(core.economicCalendar.getRange(FROM, TO)).rejects.toBeInstanceOf(FmpHttpError)
    expect(getEconomicCalendar).toHaveBeenCalledTimes(2)
  })

  it.each(['set', 'clear'] as const)('apikey.%s clears the latch', async (action) => {
    const err = new FmpHttpError(403, null)
    const getEconomicCalendar = vi.fn(async () => { throw err })
    const core = createCore(deps(getEconomicCalendar))

    await expect(core.economicCalendar.getRange(FROM, TO)).rejects.toBe(err)
    if (action === 'set') core.apikey.set('NEW'); else core.apikey.clear()
    await expect(core.economicCalendar.getRange(FROM, TO)).rejects.toBe(err)
    expect(getEconomicCalendar).toHaveBeenCalledTimes(2) // 解除されたので再度ネットワークに出た
  })

  // EI-04 でカレンダー側も classify 判定に寄せた。200 のプラン拒否で latch すること。
  it('latches on an HTTP 200 plan-denial payload', async () => {
    const err = new FmpHttpError(200, { 'Error Message': 'Invalid API KEY. Feel free to create a Free API Key' })
    const getEconomicCalendar = vi.fn(async () => { throw err })
    const core = createCore(deps(getEconomicCalendar))

    await expect(core.economicCalendar.getRange(FROM, TO)).rejects.toBe(err)
    await expect(core.economicCalendar.getRange('2026-08-03', '2026-08-03')).rejects.toBe(err)
    expect(getEconomicCalendar).toHaveBeenCalledOnce()
  })
})
