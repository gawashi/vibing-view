import { ema, sma } from './math'
import { sourceValues } from './types'
import type { IndicatorModule, LineData, Params, Source } from './types'

export const ma: IndicatorModule = {
  type: 'ma',
  label: (p) => `MA ${p.period}`, // D-30: period only — SMA/EMA is distinguished via the edit form, not the label
  defaults: { kind: 'SMA', period: 20, source: 'close' },
  params: [
    { key: 'period', kind: 'number', label: 'Period', default: 20, min: 1, step: 1 },
    { key: 'kind', kind: 'select', label: 'Type', options: ['SMA', 'EMA'], default: 'SMA' },
    { key: 'source', kind: 'source', label: 'Source', default: 'close' },
    { key: 'color', kind: 'color', label: 'Color' }
  ],
  outputs: [{ key: 'line', kind: 'line' }],
  compute(bars, p: Params): Record<string, LineData[]> {
    const values = sourceValues(bars, p.source as Source)
    const period = Number(p.period)
    const aligned = p.kind === 'EMA' ? ema(values, period) : sma(values, period)
    const line: LineData[] = []
    for (let i = 0; i < aligned.length; i++) {
      const value = aligned[i]
      if (value === undefined) continue
      line.push({ time: bars[i].time, value })
    }
    return { line }
  }
}
