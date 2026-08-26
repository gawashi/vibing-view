import { describe, it, expect, vi } from 'vitest'
import { createCore, type CoreDeps } from '../../../src/main/core'
import { FmpHttpError } from '../../../src/main/providers/FmpProvider'
import { MATURITIES } from '@shared/treasury'
import type { TreasuryCurvePoint, TreasuryMaturityKey, WorkspaceCollection } from '@shared/types'

const collection = (name: string): WorkspaceCollection => ({
  version: 3,
  active: name,
  workspaces: [{ name, items: [], layout: { schemaVersion: 1, cells: [], shape: { rows: 1, cols: 1 }, activeCellId: '1' } }]
})

// プラン拒否 body。classify がこれを 'requires-plan' に落とすことがラッチの前提。
const DENIED_BODY = {
  'Error Message': 'Invalid API KEY. Feel free to create a Free API Key or visit https://site.financialmodelingprep.com/faqs?search=why-is-my-api-key-invalid for more information.'
}

const curve = (date: string): TreasuryCurvePoint => ({
  date,
  rates: Object.fromEntries(MATURITIES.map((m) => [m.key, 4])) as Record<TreasuryMaturityKey, number | null>
})

function deps(getTreasuryRates: ReturnType<typeof vi.fn>, over: Partial<CoreDeps> = {}): CoreDeps {
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
    treasuryCurveStore: { getCurves: vi.fn(() => null), upsertCurves: vi.fn() },
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
      getEconomicCalendar: vi.fn(async () => []),
      getEconomicIndicator: vi.fn(async () => []),
      getTreasuryRates
    })),
    nowSec: () => 1_000
  }
  return { ...base, ...over }
}

describe('core.yieldCurve.getCurves', () => {
  it('reaches the provider with a from/to window and returns the curves', async () => {
    const getTreasuryRates = vi.fn(async (from: string, _to: string) => [curve(from)])
    const d = deps(getTreasuryRates)
    const r = await createCore(d).yieldCurve.getCurves({ years: 1 })

    expect(getTreasuryRates).toHaveBeenCalled()
    for (const [from, to] of getTreasuryRates.mock.calls) {
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(from < to).toBe(true)
    }
    expect(r.points.length).toBeGreaterThan(0)
    expect(r.coveredFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(d.treasuryCurveStore.getCurves).toHaveBeenCalledWith('us')
  })

  it('throws NO_API_KEY without a key, without building a provider', async () => {
    const getTreasuryRates = vi.fn()
    const d = deps(getTreasuryRates)
    d.keystore.getApiKey = vi.fn(() => null)

    await expect(createCore(d).yieldCurve.getCurves()).rejects.toThrow('NO_API_KEY')
    expect(getTreasuryRates).not.toHaveBeenCalled()
    expect(d.makeProvider).not.toHaveBeenCalled()
  })
})

describe('core.yieldCurve — off-plan short-circuit (YC-08)', () => {
  it.each([402, 403])('stops hitting the network after a %i and rethrows the same error', async (status) => {
    const err = new FmpHttpError(status, DENIED_BODY)
    const getTreasuryRates = vi.fn(async () => { throw err })
    const core = createCore(deps(getTreasuryRates))

    // 1 窓目でラッチするので、この getCurves の残りの窓（最大 22 本）も空撃ちしない。
    await expect(core.yieldCurve.getCurves()).rejects.toBe(err)
    await expect(core.yieldCurve.getCurves({ years: 5 })).rejects.toBe(err)
    expect(getTreasuryRates).toHaveBeenCalledOnce()
  })

  it('latches on an HTTP 200 plan-denial payload', async () => {
    // parseOrThrowHttpError はスキーマ外の body を FmpHttpError(200) で投げるので、
    // status 判定（402/403）だけではプラン拒否が抜ける。
    const err = new FmpHttpError(200, DENIED_BODY)
    const getTreasuryRates = vi.fn(async () => { throw err })
    const core = createCore(deps(getTreasuryRates))

    await expect(core.yieldCurve.getCurves()).rejects.toBe(err)
    await expect(core.yieldCurve.getCurves()).rejects.toBe(err)
    expect(getTreasuryRates).toHaveBeenCalledOnce()
  })

  it('does NOT latch on a schema mismatch that carries no Error Message', async () => {
    // 逆方向の保護: 純粋なスキーマ不一致で以後の取得を全部止めてはいけない。
    const err = new FmpHttpError(200, [{ bogus: 1 }])
    const getTreasuryRates = vi.fn(async () => { throw err })
    const core = createCore(deps(getTreasuryRates))

    await expect(core.yieldCurve.getCurves()).rejects.toBe(err)
    await expect(core.yieldCurve.getCurves()).rejects.toBe(err)
    expect(getTreasuryRates).toHaveBeenCalledTimes(2)
  })

  it('does not latch on a 429 (transient)', async () => {
    const getTreasuryRates = vi.fn(async () => { throw new FmpHttpError(429, null) })
    const core = createCore(deps(getTreasuryRates))

    await expect(core.yieldCurve.getCurves()).rejects.toBeInstanceOf(FmpHttpError)
    await expect(core.yieldCurve.getCurves()).rejects.toBeInstanceOf(FmpHttpError)
    expect(getTreasuryRates).toHaveBeenCalledTimes(2)
  })

  it.each(['set', 'clear'] as const)('apikey.%s clears the latch', async (action) => {
    const err = new FmpHttpError(403, DENIED_BODY)
    const getTreasuryRates = vi.fn(async () => { throw err })
    const core = createCore(deps(getTreasuryRates))

    await expect(core.yieldCurve.getCurves()).rejects.toBe(err)
    if (action === 'set') core.apikey.set('NEW'); else core.apikey.clear()
    await expect(core.yieldCurve.getCurves()).rejects.toBe(err)
    expect(getTreasuryRates).toHaveBeenCalledTimes(2)
  })

  it('is independent of the calendar and indicator latches', async () => {
    const err = new FmpHttpError(403, DENIED_BODY)
    const getEconomicCalendar = vi.fn(async () => { throw err })
    const getEconomicIndicator = vi.fn(async () => { throw err })
    const getTreasuryRates = vi.fn(async (from: string) => [curve(from)])
    const d = deps(getTreasuryRates)
    d.makeProvider = vi.fn(() => ({
      getOHLCV: vi.fn(async () => []),
      searchSymbols: vi.fn(async () => []),
      getQuote: vi.fn(),
      getMarketStatus: vi.fn(),
      getCompanyProfile: vi.fn(),
      getEconomicCalendar,
      getEconomicIndicator,
      getTreasuryRates
    }))
    const core = createCore(d)

    await expect(core.economicCalendar.getRange('2026-07-30', '2026-07-30')).rejects.toBe(err)
    await expect(core.economicIndicator.getSeries('CPI')).rejects.toBe(err)
    // 他の 2 つがラッチされてもイールドカーブは取れる
    const r = await core.yieldCurve.getCurves()
    expect(r.points.length).toBeGreaterThan(0)
  })
})
