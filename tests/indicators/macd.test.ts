import { describe, it, expect } from 'vitest'
import { macd as computeMacd } from '../../src/renderer/indicators/math'
import { macd } from '../../src/renderer/indicators/macd'
import { registry } from '../../src/renderer/indicators/registry'
import type { Bar } from '../../src/shared/types'
import type { HistPoint } from '../../src/renderer/indicators/types'

// Histogram color rule (D-42), duplicated here so the test pins the exact branch selection the
// module must emit — including the first-bar prev=0 default. Kept in sync with macd.ts compute.
const GREEN = '#22C55E'
const GREEN_50 = 'rgba(34, 197, 94, 0.5)'
const RED = '#EF4444'
const RED_50 = 'rgba(239, 68, 68, 0.5)'
function expectedColor(value: number, prev: number): string {
  if (value >= 0) return value > prev ? GREEN : GREEN_50
  return value < prev ? RED : RED_50
}

// An oscillating (sine) series drives the MACD histogram through a full cycle so all four color
// branches are exercised (positive rising/falling → green/green-50, negative falling/rising → red/red-50).
function riseFallCloses(): number[] {
  const closes: number[] = []
  for (let i = 0; i < 120; i++) closes.push(200 + 50 * Math.sin((i * 2 * Math.PI) / 30))
  return closes
}

function makeBars(closes: number[]): Bar[] {
  return closes.map((close, i) => ({ time: i, open: close, high: close, low: close, close, volume: 0 }))
}

describe('macd (math)', () => {
  it('macdLine first defined at slow-1 (25), signal+histogram at slow-1+signal-1 (33)', () => {
    const closes = riseFallCloses() // length 75 ≥ 34
    const { macd: macdLine, signal, histogram } = computeMacd(closes, 12, 26, 9)
    expect(macdLine).toHaveLength(closes.length)
    expect(signal).toHaveLength(closes.length)
    expect(histogram).toHaveLength(closes.length)

    // macdLine = ema(12) - ema(26); defined from index slow-1 = 25.
    expect(macdLine[24]).toBeUndefined()
    expect(macdLine[25]).toBeDefined()

    // signal = EMA(9) of the COMPACTED macdLine suffix, re-expanded → defined from 25 + (9-1) = 33
    // (Landmine #5: proves the dense-compaction offset is exactly one signal-window, no off-by-one).
    expect(signal[32]).toBeUndefined()
    expect(signal[33]).toBeDefined()
    expect(histogram[32]).toBeUndefined()
    expect(histogram[33]).toBeDefined()
  })

  it('signal EMA matches a manual compact→ema→re-expand of macdLine (not ema on the gappy array)', () => {
    const closes = riseFallCloses()
    const { macd: macdLine, signal } = computeMacd(closes, 12, 26, 9)
    // Manually reproduce: strip leading undefineds, dense-EMA(9), re-expand.
    const firstDefined = macdLine.findIndex((v) => v !== undefined)
    const dense = macdLine.slice(firstDefined).map((v) => v as number)
    // dense EMA(9) seeded by SMA of first 9 dense values (same recurrence as math.ema).
    const k = 2 / (9 + 1)
    const denseSignal: Array<number | undefined> = new Array(dense.length).fill(undefined)
    let prev = dense.slice(0, 9).reduce((a, b) => a + b, 0) / 9
    denseSignal[8] = prev
    for (let i = 9; i < dense.length; i++) {
      prev = dense[i] * k + prev * (1 - k)
      denseSignal[i] = prev
    }
    for (let i = 0; i < dense.length; i++) {
      const expected = denseSignal[i]
      const actual = signal[firstDefined + i]
      if (expected === undefined) expect(actual).toBeUndefined()
      else expect(actual).toBeCloseTo(expected, 8)
    }
  })

  it('histogram equals macdLine - signal at aligned indices', () => {
    const closes = riseFallCloses()
    const { macd: macdLine, signal, histogram } = computeMacd(closes, 12, 26, 9)
    for (let i = 0; i < histogram.length; i++) {
      if (histogram[i] === undefined) continue
      expect(histogram[i]).toBeCloseTo((macdLine[i] as number) - (signal[i] as number), 8)
    }
  })

  it('leaves a leading gap: everything before index 25 undefined', () => {
    const { macd: macdLine } = computeMacd(riseFallCloses(), 12, 26, 9)
    for (let i = 0; i < 25; i++) expect(macdLine[i]).toBeUndefined()
  })
})

describe('macd (module)', () => {
  it('registers under registry.macd', () => {
    expect(registry.macd).toBe(macd)
    expect(macd.type).toBe('macd')
    expect(macd.pane).toBe('separate')
  })

  it('compute returns exactly three keys macd/signal/histogram', () => {
    const bars = makeBars(riseFallCloses())
    const out = macd.compute(bars, { fast: 12, slow: 26, signal: 9 })
    expect(Object.keys(out).sort()).toEqual(['histogram', 'macd', 'signal'])
  })

  it('every histogram point carries a color', () => {
    const bars = makeBars(riseFallCloses())
    const hist = macd.compute(bars, { fast: 12, slow: 26, signal: 9 }).histogram as HistPoint[]
    expect(hist.length).toBeGreaterThan(0)
    for (const p of hist) expect(typeof p.color).toBe('string')
  })

  it('assigns the 4 histogram colors by sign × rising/falling, prev=0 for the first bar', () => {
    const bars = makeBars(riseFallCloses())
    const hist = macd.compute(bars, { fast: 12, slow: 26, signal: 9 }).histogram as HistPoint[]
    // Re-derive expected colors with prev=0 default on the first point; assert compute matches.
    let prev = 0
    for (let i = 0; i < hist.length; i++) {
      expect(hist[i].color).toBe(expectedColor(hist[i].value, prev))
      prev = hist[i].value
    }
    // The rise-then-fall series must exercise both a full-green and a 50%-green bar.
    const colors = hist.map((p) => p.color)
    expect(colors).toContain(GREEN)
    expect(colors).toContain(GREEN_50)
  })

  it('formatReadout renders the 3-value MACD/Signal/Hist string and guards missing keys', () => {
    expect(macd.formatReadout!({ macd: 1.234, signal: 0.5, histogram: 0.734 }, {})).toBe(
      'MACD 1.23 Signal 0.50 Hist 0.73'
    )
    expect(macd.formatReadout!({}, {})).toBe('MACD — Signal — Hist —')
  })

  it('guides is a static zero line', () => {
    const guides = macd.guides!({ fast: 12, slow: 26, signal: 9 })
    expect(guides).toHaveLength(1)
    expect(guides[0].value).toBe(0)
  })
})
