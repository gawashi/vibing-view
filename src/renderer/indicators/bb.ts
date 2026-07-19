import { bollinger } from './math'
import { sourceValues } from './types'
import type { IndicatorModule, LineData, Params, Source } from './types'

export const bb: IndicatorModule = {
  type: 'bb',
  label: (p) => `BB ${p.period},${p.mult}`, // D-30
  defaults: { period: 20, mult: 2, source: 'close' }, // D-29
  params: [
    { key: 'period', kind: 'number', label: 'Period', default: 20, min: 1, step: 1 },
    { key: 'mult', kind: 'number', label: 'Std Dev ×', default: 2, min: 0.1, step: 0.5 },
    { key: 'source', kind: 'source', label: 'Source', default: 'close' },
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
    const toLineData = (aligned: Array<number | undefined>): LineData[] => {
      const out: LineData[] = []
      for (let i = 0; i < aligned.length; i++) {
        const value = aligned[i]
        if (value === undefined) continue
        out.push({ time: bars[i].time, value })
      }
      return out
    }
    return { upper: toLineData(upper), middle: toLineData(middle), lower: toLineData(lower) }
  }
}
