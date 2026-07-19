import type { HistPoint, IndicatorModule } from './types'

export const volume: IndicatorModule = {
  type: 'volume',
  label: () => 'Volume',
  pane: 'separate',
  defaults: {},
  params: [],
  outputs: [{ key: 'volume', kind: 'histogram' }],
  // UI-SPEC L153: raw volume, thousands-separated, no decimals (e.g. 12,450,200). Guards missing value.
  formatReadout: (v) => (typeof v.volume === 'number' ? Math.round(v.volume).toLocaleString('en-US') : ''),
  compute(bars): Record<string, HistPoint[]> {
    const volume: HistPoint[] = bars.map((b) => ({
      time: b.time,
      value: b.volume,
      color: b.close >= b.open ? '#22C55E' : '#EF4444' // D-43: matches candle upColor/downColor exactly
    }))
    return { volume }
  }
}
