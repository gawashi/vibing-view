import { describe, it, expect, vi } from 'vitest'
import { createCore, type CoreDeps } from '../../../src/main/core'
import { FmpHttpError } from '../../../src/main/providers/FmpProvider'
import type { WorkspaceCollection } from '@shared/types'

const collection = (name: string): WorkspaceCollection => ({
  version: 3,
  active: name,
  workspaces: [{ name, items: [], layout: { schemaVersion: 1, cells: [], shape: { rows: 1, cols: 1 }, activeCellId: '1' } }]
})

// EI-01 実測の拒否 body（tests/fixtures/fmp-economic-indicators-denied.json と同じ文言）。
// classify がこれを 'requires-plan' に落とすことが latch の前提。
const DENIED_BODY = {
  'Error Message': 'Invalid API KEY. Feel free to create a Free API Key or visit https://site.financialmodelingprep.com/faqs?search=why-is-my-api-key-invalid for more information.'
}

function deps(getEconomicIndicator: ReturnType<typeof vi.fn>, over: Partial<CoreDeps> = {}): CoreDeps {
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
      getEconomicCalendar: vi.fn(async () => []),
      getEconomicIndicator
    })),
    nowSec: () => 1_000
  }
  return { ...base, ...over }
}

describe('core.economicIndicator.getSeries', () => {
  it('reaches the provider with a `to` window and returns the series', async () => {
    const getEconomicIndicator = vi.fn(async (_name: string, _to: string) => [{ date: '2026-06-01', value: 322.1 }])
    const d = deps(getEconomicIndicator)
    const r = await createCore(d).economicIndicator.getSeries('CPI', { years: 1 })

    expect(getEconomicIndicator).toHaveBeenCalled()
    for (const [name, to] of getEconomicIndicator.mock.calls) {
      expect(name).toBe('CPI')
      expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    expect(r.points).toEqual([{ date: '2026-06-01', value: 322.1 }])
    expect(r.coveredFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(d.economicIndicatorStore.getIndicator).toHaveBeenCalledWith('CPI')
  })

  it('throws NO_API_KEY without a key, without building a provider', async () => {
    const getEconomicIndicator = vi.fn()
    const d = deps(getEconomicIndicator)
    d.keystore.getApiKey = vi.fn(() => null)

    await expect(createCore(d).economicIndicator.getSeries('CPI')).rejects.toThrow('NO_API_KEY')
    expect(getEconomicIndicator).not.toHaveBeenCalled()
    expect(d.makeProvider).not.toHaveBeenCalled()
  })
})

describe('core.economicIndicator — off-plan short-circuit (EI-04)', () => {
  it.each([402, 403])('stops hitting the network after a %i and rethrows the same error', async (status) => {
    const err = new FmpHttpError(status, DENIED_BODY)
    const getEconomicIndicator = vi.fn(async () => { throw err })
    const d = deps(getEconomicIndicator)
    const core = createCore(d)

    // 1 窓目で latch するので、この getSeries の残りの窓も空撃ちしない。
    await expect(core.economicIndicator.getSeries('CPI')).rejects.toBe(err)
    await expect(core.economicIndicator.getSeries('GDP')).rejects.toBe(err)
    expect(getEconomicIndicator).toHaveBeenCalledOnce() // 別の name でもネットワークに出ない
    expect(d.makeProvider).toHaveBeenCalledOnce()
  })

  // ここが status 判定では抜ける穴。parseOrThrowHttpError はスキーマ外の body を
  // FmpHttpError(200) で投げるので、プラン拒否が 200 で来ると latch が効かず 23 本 × 22 窓
  // ぶん空撃ちする。
  it('latches on an HTTP 200 plan-denial payload', async () => {
    const err = new FmpHttpError(200, DENIED_BODY)
    const getEconomicIndicator = vi.fn(async () => { throw err })
    const core = createCore(deps(getEconomicIndicator))

    await expect(core.economicIndicator.getSeries('CPI')).rejects.toBe(err)
    await expect(core.economicIndicator.getSeries('unemploymentRate')).rejects.toBe(err)
    expect(getEconomicIndicator).toHaveBeenCalledOnce()
  })

  // 逆方向の保護: 純粋なスキーマ不一致で 23 本すべてを止めてはいけない。
  it('does NOT latch on a schema mismatch that carries no Error Message', async () => {
    const err = new FmpHttpError(200, [{ bogus: 1 }])
    const getEconomicIndicator = vi.fn(async () => { throw err })
    const core = createCore(deps(getEconomicIndicator))

    await expect(core.economicIndicator.getSeries('CPI')).rejects.toBe(err)
    await expect(core.economicIndicator.getSeries('GDP')).rejects.toBe(err)
    expect(getEconomicIndicator).toHaveBeenCalledTimes(2) // 他の指標は取得を試みられる
  })

  it('does not latch on a 429 (transient)', async () => {
    const getEconomicIndicator = vi.fn(async () => { throw new FmpHttpError(429, null) })
    const core = createCore(deps(getEconomicIndicator))

    await expect(core.economicIndicator.getSeries('CPI')).rejects.toBeInstanceOf(FmpHttpError)
    await expect(core.economicIndicator.getSeries('CPI')).rejects.toBeInstanceOf(FmpHttpError)
    expect(getEconomicIndicator).toHaveBeenCalledTimes(2)
  })

  it.each(['set', 'clear'] as const)('apikey.%s clears the latch', async (action) => {
    const err = new FmpHttpError(403, DENIED_BODY)
    const getEconomicIndicator = vi.fn(async () => { throw err })
    const core = createCore(deps(getEconomicIndicator))

    await expect(core.economicIndicator.getSeries('CPI')).rejects.toBe(err)
    if (action === 'set') core.apikey.set('NEW'); else core.apikey.clear()
    await expect(core.economicIndicator.getSeries('CPI')).rejects.toBe(err)
    expect(getEconomicIndicator).toHaveBeenCalledTimes(2)
  })

  it('is independent of the calendar latch', async () => {
    const err = new FmpHttpError(403, DENIED_BODY)
    const getEconomicCalendar = vi.fn(async () => { throw err })
    const getEconomicIndicator = vi.fn(async () => [{ date: '2026-06-01', value: 1 }])
    const d = deps(getEconomicIndicator)
    d.makeProvider = vi.fn(() => ({
      getOHLCV: vi.fn(async () => []),
      searchSymbols: vi.fn(async () => []),
      getQuote: vi.fn(),
      getMarketStatus: vi.fn(),
      getCompanyProfile: vi.fn(),
      getEconomicCalendar,
      getEconomicIndicator
    }))
    const core = createCore(d)

    await expect(core.economicCalendar.getRange('2026-07-27', '2026-07-27')).rejects.toBe(err)
    // カレンダーが latch されても指標は取れる
    const r = await core.economicIndicator.getSeries('CPI')
    expect(r.points).toHaveLength(1)
  })
})
