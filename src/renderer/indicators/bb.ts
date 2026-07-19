import { bollinger } from './math'
import { alignLine, sourceValues } from './types'
import type { IndicatorModule, LineData, Params, Source } from './types'

export const bb: IndicatorModule = {
  type: 'bb',
  label: (p) => `BB ${p.period},${p.mult}`, // D-30
  defaults: { period: 20, mult: 2, source: 'close' }, // D-29
  params: [
    { key: 'period', kind: 'number', label: 'Period', min: 1, step: 1 },
    { key: 'mult', kind: 'number', label: 'Std Dev ×', min: 0.1, step: 0.5 },
    { key: 'source', kind: 'source', label: 'Source' },
    { key: 'color', kind: 'color', label: 'Color' }
  ],
  outputs: [
    { key: 'upper', kind: 'line' },
    { key: 'middle', kind: 'line' },
    { key: 'lower', kind: 'line' },
    { key: 'band', kind: 'band', between: ['upper', 'lower'] }
  ],
  compute(bars, p: Params): Record<string, LineData[]> {
    const values = sourceValues(bars, p.source as Source)
    const { upper, middle, lower } = bollinger(values, Number(p.period), Number(p.mult))
    return {
      upper: alignLine(bars, upper),
      middle: alignLine(bars, middle),
      lower: alignLine(bars, lower)
    }
  }
}
