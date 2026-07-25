import { describe, it, expect } from 'vitest'
import {
  parseIsoToEpoch, formatEpoch, clampLimit, interpretationNote, unmetRangeNotes,
  summaryLine, toCsv, formatCacheStatus, formatWorkspaceList, formatWorkspaceDetail,
  formatSymbolResults, formatQuote, formatCompanyInfo
} from '../../../src/main/mcp/format'
import type { Bar, Timeframe, WorkspaceCollection, Workspace, SymbolResult, Quote, CompanyInfo } from '@shared/types'
import type { CapabilityStatus } from '@shared/ipc'

const at = (iso: string): number => Math.floor(Date.parse(iso) / 1000)
const bar = (time: number): Bar => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 })

describe('parseIsoToEpoch', () => {
  it('reads a date as midnight UTC', () => {
    expect(parseIsoToEpoch('2026-07-24')).toBe(at('2026-07-24T00:00:00Z'))
  })

  it('reads a full ISO timestamp', () => {
    expect(parseIsoToEpoch('2026-07-24T13:30:00Z')).toBe(at('2026-07-24T13:30:00Z'))
  })

  it('throws on garbage', () => {
    expect(() => parseIsoToEpoch('yesterday')).toThrow()
  })
})

describe('formatEpoch', () => {
  it('prints a date for daily-backed timeframes', () => {
    expect(formatEpoch(at('2026-07-24T00:00:00Z'), '1d')).toBe('2026-07-24')
    expect(formatEpoch(at('2026-07-24T00:00:00Z'), '1M')).toBe('2026-07-24')
  })

  it('prints a full timestamp for intraday', () => {
    expect(formatEpoch(at('2026-07-24T13:30:00Z'), '5m')).toBe('2026-07-24T13:30:00Z')
  })
})

describe('clampLimit', () => {
  it('defaults to 300', () => {
    expect(clampLimit(undefined)).toEqual({ limit: 300, note: null })
  })

  it('passes an in-range limit through', () => {
    expect(clampLimit(50)).toEqual({ limit: 50, note: null })
  })

  it('caps at 2000 and says so', () => {
    expect(clampLimit(5000)).toEqual({ limit: 2000, note: 'note: limit was capped at 2000 (requested 5000).' })
  })
})

describe('interpretationNote', () => {
  it('explains a date-only bound on an intraday request', () => {
    expect(interpretationNote('from', '2026-01-01', '5m')).toBe('note: from=2026-01-01 was read as 2026-01-01T00:00:00Z.')
  })

  it('says nothing for a daily request', () => {
    expect(interpretationNote('from', '2026-01-01', '1d')).toBeNull()
  })

  it('says nothing when a full timestamp was given', () => {
    expect(interpretationNote('to', '2026-01-01T10:00:00Z', '5m')).toBeNull()
  })
})

describe('unmetRangeNotes', () => {
  it('warns when the oldest returned bar is newer than the requested from', () => {
    const notes = unmetRangeNotes({ from: '2026-01-01' }, [bar(at('2026-07-18T13:30:00Z'))], '5m')
    expect(notes).toEqual([
      'note: requested from=2026-01-01 but the oldest bar returned is 2026-07-18T13:30:00Z — the FMP plan may not carry intraday history that far back. This is NOT the complete history for that range.'
    ])
  })

  it('warns when the newest returned bar is older than the requested to', () => {
    const notes = unmetRangeNotes({ to: '2026-07-24' }, [bar(at('2026-07-20T00:00:00Z'))], '1d')
    expect(notes).toEqual([
      'note: requested to=2026-07-24 but the newest bar returned is 2026-07-20 — pass force=true to fetch newer bars from FMP.'
    ])
  })

  it('says nothing when the range was satisfied', () => {
    const bars = [bar(at('2026-07-01T00:00:00Z')), bar(at('2026-07-24T00:00:00Z'))]
    expect(unmetRangeNotes({ from: '2026-07-01', to: '2026-07-24' }, bars, '1d')).toEqual([])
  })

  it('says nothing when no bounds were requested', () => {
    expect(unmetRangeNotes({}, [bar(1)], '1d')).toEqual([])
  })
})

describe('summaryLine', () => {
  it('reports a cache hit', () => {
    const shown = [bar(at('2025-05-12T00:00:00Z')), bar(at('2026-07-24T00:00:00Z'))]
    expect(summaryLine({ symbol: 'NVDA', timeframe: '1d', shown, total: 4812, apiCalls: 0 }))
      .toBe('NVDA 1d — 2 of 4812 cached bars, 2025-05-12 to 2026-07-24 (cache hit, no API call)')
  })

  it('reports the number of API calls made', () => {
    const shown = [bar(at('2026-07-18T13:30:00Z'))]
    expect(summaryLine({ symbol: 'NVDA', timeframe: '5m', shown, total: 1170, apiCalls: 1 }))
      .toBe('NVDA 5m — 1 of 1170 cached bars, 2026-07-18T13:30:00Z to 2026-07-18T13:30:00Z (1 API call)')
  })
})

describe('toCsv', () => {
  it('emits a header and one row per bar', () => {
    expect(toCsv([bar(at('2026-07-24T00:00:00Z'))], '1d')).toBe(
      'time,open,high,low,close,volume\n2026-07-24,1,2,0.5,1.5,100'
    )
  })
})

const caps: Record<Timeframe, CapabilityStatus> = {
  '1m': 'unknown', '5m': 'available', '15m': 'unknown', '1h': 'requires-plan',
  '1d': 'available', '1w': 'available', '1M': 'available'
}

describe('formatCacheStatus', () => {
  it('lists every series and tags the daily row with its derived timeframes', () => {
    const rows = [
      { symbol: 'AAPL', timeframe: '1d' as const, count: 4812, oldestTime: at('1998-01-02T00:00:00Z'), newestTime: at('2026-07-24T00:00:00Z') },
      { symbol: 'NVDA', timeframe: '5m' as const, count: 1170, oldestTime: at('2026-07-18T13:30:00Z'), newestTime: at('2026-07-24T20:00:00Z') }
    ]
    const text = formatCacheStatus(rows, caps)
    expect(text).toContain('AAPL 1d — 4812 bars, 1998-01-02 to 2026-07-24 (also serves 1w, 1M)')
    expect(text).toContain('NVDA 5m — 1170 bars, 2026-07-18T13:30:00Z to 2026-07-24T20:00:00Z')
    expect(text).toContain('Timeframe capability: 1m unknown, 5m available, 15m unknown, 1h requires-plan, 1d available, 1w available, 1M available')
  })

  it('says so when a symbol has nothing cached', () => {
    expect(formatCacheStatus([], caps, 'TSLA')).toContain('Nothing cached for TSLA.')
  })
})

const workspace = (name: string): Workspace => ({
  name,
  items: [{ symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ' }],
  layout: {
    schemaVersion: 1,
    shape: { rows: 2, cols: 2 },
    activeCellId: 'c1',
    cells: [
      { id: 'c1', symbol: 'NVDA', timeframe: '1d', indicators: [{ id: 'i1', type: 'ma', params: { period: 20 }, colors: {}, visible: true }] },
      { id: 'c2', symbol: null, timeframe: '5m', indicators: [] }
    ]
  }
})

describe('formatWorkspaceList', () => {
  it('summarises each workspace on one line', () => {
    const collection: WorkspaceCollection = { version: 3, active: 'Main', workspaces: [workspace('Main'), workspace('Scratch')] }
    expect(formatWorkspaceList(collection)).toBe(
      [
        'Workspaces (2) — active: Main',
        '- Main (active) — 1 watchlist symbol, 2x2 grid, 2 cells',
        '- Scratch — 1 watchlist symbol, 2x2 grid, 2 cells'
      ].join('\n')
    )
  })
})

describe('formatWorkspaceDetail', () => {
  it('prints the watchlist and every cell with its indicators', () => {
    const text = formatWorkspaceDetail(workspace('Main'), true)
    expect(text).toContain('Workspace: Main (active)')
    expect(text).toContain('Grid: 2 rows x 2 cols, active cell: c1')
    expect(text).toContain('- NVDA — NVIDIA Corporation (NASDAQ)')
    expect(text).toContain('- [c1] NVDA 1d — ma(period=20)')
    expect(text).toContain('- [c2] (empty) 5m — no indicators')
  })
})

describe('formatSymbolResults', () => {
  it('says so when there are no matches', () => {
    expect(formatSymbolResults([])).toBe('No matches.')
  })

  it('uses the singular for one match', () => {
    const results: SymbolResult[] = [{ symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ' }]
    expect(formatSymbolResults(results)).toBe(
      ['1 match:', '- NVDA — NVIDIA Corporation (NASDAQ)'].join('\n')
    )
  })

  it('uses the plural and lists every match', () => {
    const results: SymbolResult[] = [
      { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ' },
      { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }
    ]
    expect(formatSymbolResults(results)).toBe(
      [
        '2 matches:',
        '- NVDA — NVIDIA Corporation (NASDAQ)',
        '- AAPL — Apple Inc. (NASDAQ)'
      ].join('\n')
    )
  })
})

describe('formatQuote', () => {
  const base: Quote = {
    price: 120.5,
    open: 118,
    dayHigh: 121,
    dayLow: 117.5,
    previousClose: 119,
    changePercentage: 1.26,
    timestamp: at('2026-07-24T20:00:00Z'),
    exchange: 'NASDAQ'
  }

  it('formats a normal quote with a leading + on a positive change', () => {
    expect(formatQuote('NVDA', base)).toBe(
      [
        'NVDA — 120.5 (+1.26%) as of 2026-07-24T20:00:00.000Z',
        'open 118, day high 121, day low 117.5, previous close 119',
        'exchange: NASDAQ'
      ].join('\n')
    )
  })

  it('omits the + sign for a negative change', () => {
    const q: Quote = { ...base, changePercentage: -2.5 }
    expect(formatQuote('NVDA', q)).toBe(
      [
        'NVDA — 120.5 (-2.5%) as of 2026-07-24T20:00:00.000Z',
        'open 118, day high 121, day low 117.5, previous close 119',
        'exchange: NASDAQ'
      ].join('\n')
    )
  })
})

describe('formatCompanyInfo', () => {
  const info: CompanyInfo = {
    symbol: 'NVDA',
    companyName: 'NVIDIA Corporation',
    image: null,
    exchange: 'NASDAQ',
    sector: 'Technology',
    industry: 'Semiconductors',
    country: 'US',
    marketCap: 3_000_000_000_000,
    ceo: 'Jensen Huang',
    fullTimeEmployees: 29600,
    ipoDate: '1999-01-22',
    website: null,
    description: null,
    beta: 1.7,
    range: null,
    volume: null,
    averageVolume: null,
    lastDividend: null,
    price: 120.5,
    valuation: { peRatio: 65, pbRatio: null, psRatio: null, pegRatio: null, dividendYield: null, evToEbitda: null, earningsYield: null, fcfYield: null },
    financials: null,
    analyst: undefined,
    growth: { revenueGrowth: 0.5, netIncomeGrowth: 0.6, epsGrowth: 0.4 },
    schedule: null,
    fetchedAt: at('2026-07-24T00:00:00Z')
  }

  it('prints a present group in full and a null group as not available, never omitted', () => {
    const text = formatCompanyInfo(info, false)
    expect(text).toContain('valuation: peRatio=65, pbRatio=—, psRatio=—, pegRatio=—, dividendYield=—, evToEbitda=—, earningsYield=—, fcfYield=—')
    expect(text).toContain('financials: not available')
  })

  it('prints an undefined group as not available too', () => {
    expect(formatCompanyInfo(info, false)).toContain('analyst: not available')
  })

  it('renders null scalars as the em-dash placeholder', () => {
    const text = formatCompanyInfo(info, false)
    expect(text).toContain('market cap: 3000000000000, price: 120.5, beta: 1.7, employees: 29600')
    expect(text).toContain('sector: Technology, industry: Semiconductors, country: US')
  })

  it('prints the header and every present group', () => {
    const text = formatCompanyInfo(info, false)
    expect(text).toContain('NVDA — NVIDIA Corporation (as of 2026-07-24T00:00:00.000Z)')
    expect(text).toContain('growth: revenueGrowth=0.5, netIncomeGrowth=0.6, epsGrowth=0.4')
    expect(text).toContain('schedule: not available')
  })

  it('adds the stale line when forcedButStale is set', () => {
    expect(formatCompanyInfo(info, false)).not.toContain('stale:')
    expect(formatCompanyInfo(info, true)).toContain('stale: fetch failed, showing cached')
  })
})
