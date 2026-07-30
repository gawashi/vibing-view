import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { FmpProvider, FmpHttpError } from '../../../src/main/providers/FmpProvider'
import { MATURITIES, SPREADS } from '@shared/treasury'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(`tests/fixtures/${name}.json`), 'utf8'))

const provider = (httpGetJson: ReturnType<typeof vi.fn>): FmpProvider =>
  new FmpProvider({ apiKey: 'KEY', httpGetJson })

// 12 満期すべてを持つ 1 行（date 以外は上書き可能）。
const row = (date: string, over: Record<string, number | null> = {}): Record<string, unknown> => ({
  date,
  ...Object.fromEntries(MATURITIES.map((m, i) => [m.key, 4 + i / 100])),
  ...over
})

describe('満期レジストリと schema の対応', () => {
  it('MATURITIES は 12 満期で、キーが一意・月数が昇順', () => {
    expect(MATURITIES).toHaveLength(12)
    expect(new Set(MATURITIES.map((m) => m.key)).size).toBe(12)
    const months = MATURITIES.map((m) => m.months)
    expect([...months].sort((a, b) => a - b)).toEqual(months)
  })

  it('SPREADS が参照する満期はすべて MATURITIES にある', () => {
    const keys = new Set(MATURITIES.map((m) => m.key))
    for (const s of SPREADS) {
      expect(keys.has(s.long)).toBe(true)
      expect(keys.has(s.short)).toBe(true)
    }
  })
})

describe('FmpProvider.getTreasuryRates', () => {
  it('sends both from and to (統計指標と違い from が効く)', async () => {
    const httpGetJson = vi.fn(async (_url: string) => [])
    await provider(httpGetJson).getTreasuryRates('2026-05-06', '2026-07-30')
    const url = httpGetJson.mock.calls[0]![0] as string
    expect(url).toContain('/treasury-rates?from=2026-05-06')
    expect(url).toContain('to=2026-07-30')
  })

  it('parses the fixture into date-ascending points with all 12 maturities', async () => {
    const httpGetJson = vi.fn(async () => fixture('fmp-treasury-rates'))
    const points = await provider(httpGetJson).getTreasuryRates('2026-07-27', '2026-07-29')

    expect(points).toHaveLength(3)
    // fixture は FMP の応答そのままで date 降順。昇順に直っていることを固定する。
    expect(points.map((p) => p.date)).toEqual(['2026-07-27', '2026-07-28', '2026-07-29'])
    for (const p of points) {
      expect(Object.keys(p.rates).sort()).toEqual(MATURITIES.map((m) => m.key).sort())
      for (const m of MATURITIES) {
        const v = p.rates[m.key]
        expect(v === null || typeof v === 'number').toBe(true)
      }
    }
  })

  it('keeps a null maturity instead of dropping the day (YC-03)', async () => {
    const httpGetJson = vi.fn(async () => fixture('fmp-treasury-rates'))
    const points = await provider(httpGetJson).getTreasuryRates('2026-07-27', '2026-07-29')
    // fixture の最古の行は 20Y/30Y が null。行は残り、その満期だけ null になる。
    expect(points[0].rates.year30).toBeNull()
    expect(points[0].rates.year20).toBeNull()
    expect(points[0].rates.year10).not.toBeNull()
  })

  it('maps a missing maturity field to null (仕様変更で満期が消えても行は残す)', async () => {
    const partial = { ...row('2026-07-29') }
    delete partial.year30
    const httpGetJson = vi.fn(async () => [partial])
    const points = await provider(httpGetJson).getTreasuryRates('2026-07-29', '2026-07-29')
    expect(points[0].rates.year30).toBeNull()
  })

  it('coerces numeric strings (FMP は型を混ぜることがある)', async () => {
    const httpGetJson = vi.fn(async () => [row('2026-07-29', { year10: '4.18' as unknown as number })])
    const points = await provider(httpGetJson).getTreasuryRates('2026-07-29', '2026-07-29')
    expect(points[0].rates.year10).toBe(4.18)
  })

  it.each(['2026-99-99', '2026-7-1', 'not-a-date', ''])(
    'drops the row whose date does not round-trip as a UTC day: %s',
    async (bad) => {
      const httpGetJson = vi.fn(async () => [row(bad), row('2026-07-29')])
      const points = await provider(httpGetJson).getTreasuryRates('2026-07-01', '2026-07-29')
      // 正規表現で形だけ見ると '2026-99-99' が通り、それが窓の最古になった瞬間 shiftUtcDay が
      // Invalid Date の toISOString() で throw してバックフィルが止まる（YC-03）。
      expect(points.map((p) => p.date)).toEqual(['2026-07-29'])
    }
  )

  it('returns [] for an empty body (service が「取得失敗」として扱う)', async () => {
    const httpGetJson = vi.fn(async () => [])
    expect(await provider(httpGetJson).getTreasuryRates('2026-05-06', '2026-07-30')).toEqual([])
  })

  it('wraps an out-of-schema body as FmpHttpError(200)', async () => {
    const httpGetJson = vi.fn(async () => ({ 'Error Message': 'Exclusive Endpoint' }))
    const p = provider(httpGetJson)
    await expect(p.getTreasuryRates('2026-05-06', '2026-07-30')).rejects.toBeInstanceOf(FmpHttpError)
    await expect(p.getTreasuryRates('2026-05-06', '2026-07-30')).rejects.toMatchObject({ status: 200 })
  })
})
