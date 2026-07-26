import { macd as computeMacd } from './math'
import { alignLine } from './types'
import type { HistPoint, IndicatorModule, LineData, Params } from './types'

// D-42 four-shade histogram colors (UI-SPEC L97-100): full/50% green (positive rising/falling),
// full/50% red (negative falling/rising vs the previous defined histogram value).
const GREEN = '#22C55E'
const GREEN_50 = 'rgba(34, 197, 94, 0.5)'
const RED = '#EF4444'
const RED_50 = 'rgba(239, 68, 68, 0.5)'

export const macd: IndicatorModule = {
  type: 'macd',
  label: (p) => `MACD ${p.fast},${p.slow},${p.signal}`,
  pane: 'separate',
  defaults: { fast: 12, slow: 26, signal: 9 },
  params: [
    { key: 'fast', kind: 'number', label: 'Fast', min: 1, step: 1 },
    { key: 'slow', kind: 'number', label: 'Slow', min: 1, step: 1 },
    { key: 'signal', kind: 'number', label: 'Signal', min: 1, step: 1 },
    { key: 'color', kind: 'color', label: 'Color' }
  ],
  // histogram LAST so the two lines draw on top of the bars (RESEARCH Q3).
  outputs: [
    { key: 'macd', kind: 'line' },
    { key: 'signal', kind: 'line' },
    { key: 'histogram', kind: 'histogram' }
  ],
  // Static zero line (D-46) — 0 is never edited, so no param-function needed, but the field is a function.
  guides: () => [{ value: 0, color: '#8B92A0' }],
  formatReadout: (v) =>
    `MACD ${v.macd?.toFixed(2) ?? '—'} Signal ${v.signal?.toFixed(2) ?? '—'} Hist ${v.histogram?.toFixed(2) ?? '—'}`,
  compute(bars, p: Params): Record<string, LineData[] | HistPoint[]> {
    const closes = bars.map((b) => b.close)
    const { macd: macdLine, signal, histogram } = computeMacd(
      closes,
      Number(p.fast),
      Number(p.slow),
      Number(p.signal)
    )
    // Per-bar 4-color assignment (D-42) vs the PREVIOUS defined histogram value; first bar uses prev=0.
    const histData: HistPoint[] = []
    let prev = 0
    for (let i = 0; i < histogram.length; i++) {
      const value = histogram[i]
      if (value === undefined) continue
      const color = value >= 0 ? (value > prev ? GREEN : GREEN_50) : value < prev ? RED : RED_50
      histData.push({ time: bars[i].time, value, color })
      prev = value
    }
    return { macd: alignLine(bars, macdLine), signal: alignLine(bars, signal), histogram: histData }
  }
}
