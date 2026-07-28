import { describe, it, expect } from 'vitest'
import {
  ECONOMIC_INDICATORS, ECONOMIC_INDICATOR_CATEGORIES, DEFAULT_ECONOMIC_INDICATOR,
  indicatorMeta, resolveIndicator
} from '@shared/economicIndicators'

describe('ECONOMIC_INDICATORS', () => {
  it('has 23 entries with unique names', () => {
    expect(ECONOMIC_INDICATORS).toHaveLength(23)
    expect(new Set(ECONOMIC_INDICATORS.map((m) => m.name)).size).toBe(23)
  })

  it('gives every entry a label, a unit, and a known category', () => {
    for (const m of ECONOMIC_INDICATORS) {
      expect(m.label.length).toBeGreaterThan(0)
      expect(m.unit.length).toBeGreaterThan(0) // API が単位を返さないので必須（EI-01 実測）
      expect(ECONOMIC_INDICATOR_CATEGORIES).toContain(m.category)
    }
  })

  it('covers every category with at least one indicator (空グループを出さない)', () => {
    for (const c of ECONOMIC_INDICATOR_CATEGORIES) {
      expect(ECONOMIC_INDICATORS.some((m) => m.category === c)).toBe(true)
    }
  })

  it('has the default indicator in the registry', () => {
    expect(indicatorMeta(DEFAULT_ECONOMIC_INDICATOR)).not.toBeNull()
  })

  it('returns null for an unknown name', () => {
    expect(indicatorMeta('nope')).toBeNull()
  })
})

describe('resolveIndicator — 当たる例', () => {
  it.each([
    ['CPI MoM', 'CPI'],
    ['CPI YoY', 'CPI'],
    ['Inflation Rate YoY', 'inflationRate'],
    ['Initial Jobless Claims', 'initialClaims'],
    ['Nonfarm Payrolls', 'totalNonfarmPayroll'],
    ['Unemployment Rate', 'unemploymentRate'],
    ['Fed Interest Rate Decision', 'federalFunds'],
    ['GDP Growth Rate QoQ Adv', 'GDP'],
    ['Retail Sales MoM', 'retailSales'],
    ['Michigan Consumer Sentiment Prel', 'consumerSentiment'],
    ['Durable Goods Orders MoM', 'durableGoods'],
    ['Industrial Production MoM', 'industrialProductionTotalIndex'],
    ['Housing Starts', 'newPrivatelyOwnedHousingUnitsStartedTotalUnits'],
    ['Total Vehicle Sales', 'totalVehicleSales']
  ])('%s → %s', (event, expected) => {
    expect(resolveIndicator(event, 'US')).toBe(expected)
  })

  it('ignores case', () => {
    expect(resolveIndicator('cpi mom', 'US')).toBe('CPI')
    expect(resolveIndicator('INITIAL JOBLESS CLAIMS', 'US')).toBe('initialClaims')
  })
})

describe('resolveIndicator — core の除外が先に効く', () => {
  // FMP はコア系列を持たない。ヘッドラインに飛ばすと別の指標を見せるので、リンクを張らない。
  it.each([
    'Core Inflation Rate YoY',
    'Core CPI MoM',
    'Core PCE Price Index MoM',
    'core retail sales mom'
  ])('%s → null', (event) => {
    expect(resolveIndicator(event, 'US')).toBeNull()
  })
})

describe('resolveIndicator — 当たらない例', () => {
  it.each([
    'FOMC Press Conference',
    'Fed Chair Powell Speech',
    'Thanksgiving Day',
    '10-Year Note Auction'
  ])('%s → null', (event) => {
    expect(resolveIndicator(event, 'US')).toBeNull()
  })
})

describe('resolveIndicator — 国の絞り込み', () => {
  it.each(['JP', 'EU', 'UK', 'CN', ''])('%s は常に null', (country) => {
    expect(resolveIndicator('CPI MoM', country)).toBeNull()
  })
})

describe('resolveIndicator — レジストリとの整合', () => {
  // 対応表がレジストリに無い名前を返すと、窓が「未知の指標」を開いてラベルも単位も出ない。
  it('only ever returns a name that exists in the registry', () => {
    const events = [
      'CPI MoM', 'Inflation Rate YoY', 'Initial Jobless Claims', 'Nonfarm Payrolls',
      'Unemployment Rate', 'Fed Interest Rate Decision', 'GDP Growth Rate QoQ',
      'Retail Sales MoM', 'Michigan Consumer Sentiment', 'Durable Goods Orders MoM',
      'Industrial Production MoM', 'Housing Starts', 'Total Vehicle Sales'
    ]
    for (const e of events) {
      const name = resolveIndicator(e, 'US')
      expect(name).not.toBeNull()
      expect(indicatorMeta(name!)).not.toBeNull()
    }
  })
})
