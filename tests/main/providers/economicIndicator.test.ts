import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { FmpProvider, FmpHttpError } from '../../../src/main/providers/FmpProvider'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(`tests/fixtures/${name}.json`), 'utf8'))

const provider = (httpGetJson: ReturnType<typeof vi.fn>): FmpProvider =>
  new FmpProvider({ apiKey: 'KEY', httpGetJson })

describe('FmpProvider.getEconomicIndicator', () => {
  it('parses the fixture into date-ascending points without epoch conversion', async () => {
    const httpGetJson = vi.fn(async (_url: string) => fixture('fmp-economic-indicators'))
    const points = await provider(httpGetJson).getEconomicIndicator('CPI', '2025-07-01')

    expect(points.length).toBeGreaterThan(0)
    for (const p of points) {
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(typeof p.value).toBe('number')
    }
    // fixture は FMP の応答そのままで date 降順。昇順に直っていることを固定する。
    const dates = points.map((p) => p.date)
    expect([...dates].sort()).toEqual(dates)
  })

  it('parses the weekly fixture (90 日窓ちょうど = 14 観測)', async () => {
    const httpGetJson = vi.fn(async (_url: string) => fixture('fmp-economic-indicators-weekly'))
    const points = await provider(httpGetJson).getEconomicIndicator('30YearFixedRateMortgageAverage', '2025-12-31')
    expect(points).toHaveLength(14)
    expect(points[0].date).toBe('2025-10-02')
    expect(points.at(-1)!.date).toBe('2025-12-31')
  })

  it('requests the name+to window and never sends from (EI-01: from は窓を広げない)', async () => {
    const httpGetJson = vi.fn(async (_url: string) => [])
    await provider(httpGetJson).getEconomicIndicator('unemploymentRate', '2026-07-27')
    expect(httpGetJson).toHaveBeenCalledTimes(1)
    const url = httpGetJson.mock.calls[0][0] as string
    expect(url).toContain('/economic-indicators?name=unemploymentRate')
    expect(url).toContain('to=2026-07-27')
    expect(url).not.toContain('from=')
  })

  it('returns [] for a window with no observations (四半期系列は合法的に空)', async () => {
    const httpGetJson = vi.fn(async (_url: string) => [])
    expect(await provider(httpGetJson).getEconomicIndicator('GDP', '2025-12-31')).toEqual([])
  })

  it('drops observations whose value is null (FRED の欠測)', async () => {
    const httpGetJson = vi.fn(async (_url: string) => [
      { name: 'CPI', date: '2026-06-01', value: 322.1 },
      { name: 'CPI', date: '2026-05-01', value: null },
      { name: 'CPI', date: '2026-04-01', value: 320.5 }
    ])
    const points = await provider(httpGetJson).getEconomicIndicator('CPI', '2026-06-01')
    expect(points).toEqual([
      { date: '2026-04-01', value: 320.5 },
      { date: '2026-06-01', value: 322.1 }
    ])
  })

  it('drops observations whose date is not YYYY-MM-DD (マージキーが壊れるので通さない)', async () => {
    const httpGetJson = vi.fn(async (_url: string) => [
      { name: 'CPI', date: '2026-6-1', value: 1 },
      { name: 'CPI', date: '2026-06-01', value: 2 }
    ])
    const points = await provider(httpGetJson).getEconomicIndicator('CPI', '2026-06-01')
    expect(points).toEqual([{ date: '2026-06-01', value: 2 }])
  })

  it('wraps an error payload as FmpHttpError(200)', async () => {
    const httpGetJson = vi.fn(async (_url: string) => fixture('fmp-economic-indicators-denied'))
    const p = provider(httpGetJson)
    await expect(p.getEconomicIndicator('CPI', '2026-06-01')).rejects.toBeInstanceOf(FmpHttpError)
    await expect(p.getEconomicIndicator('CPI', '2026-06-01')).rejects.toMatchObject({ status: 200 })
  })

  it('url-encodes the name', async () => {
    const httpGetJson = vi.fn(async (_url: string) => [])
    await provider(httpGetJson).getEconomicIndicator('3MonthOr90DayRatesAndYieldsCertificatesOfDeposit', '2026-06-01')
    expect(httpGetJson).toHaveBeenCalledTimes(1)
    const url = httpGetJson.mock.calls[0][0] as string
    expect(url).toContain('name=3MonthOr90DayRatesAndYieldsCertificatesOfDeposit')
  })
})
