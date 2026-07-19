import { rsi as computeRsi } from './math'
import { alignLine } from './types'
import type { IndicatorModule, LineData, Params } from './types'

export const rsi: IndicatorModule = {
  type: 'rsi',
  label: (p) => `RSI ${p.period}`,
  pane: 'separate',
  scale: { min: 0, max: 100 }, // D-45 — fixed 0-100 vertical scale
  defaults: { period: 14, overbought: 70, oversold: 30 }, // D-44
  params: [
    { key: 'period', kind: 'number', label: 'Period', min: 1, step: 1 },
    { key: 'overbought', kind: 'number', label: 'Overbought', min: 0, step: 1 },
    { key: 'oversold', kind: 'number', label: 'Oversold', min: 0, step: 1 },
    { key: 'color', kind: 'color', label: 'Color' }
    // No `source` field — RSI conventionally operates on close only (IND-05).
  ],
  outputs: [{ key: 'line', kind: 'line' }],
  // Param-driven (Landmine #1) so editing the thresholds moves the drawn 70/30 lines + zone live.
  guides: (p) => [{ value: Number(p.overbought) }, { value: Number(p.oversold) }],
  band: (p) => ({ from: Number(p.oversold), to: Number(p.overbought), color: '#8B92A0' }),
  compute(bars, p: Params): Record<string, LineData[]> {
    const closes = bars.map((b) => b.close)
    const aligned = computeRsi(closes, Number(p.period))
    return { line: alignLine(bars, aligned) }
  }
}
