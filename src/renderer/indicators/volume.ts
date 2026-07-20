import type { HistPoint, IndicatorModule } from './types'

// UI-SPEC: 出来高の軸目盛りは桁数を抑えて K/M/B 短縮（小数2桁）。1000未満は整数のまま。
export function abbreviate(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3) return (v / 1e3).toFixed(2) + 'K'
  return String(Math.round(v))
}

export const volume: IndicatorModule = {
  type: 'volume',
  label: () => 'Volume',
  pane: 'separate',
  defaults: {},
  params: [],
  // 軸ティック/クロスヘア価格ラベルのみ短縮（priceFormat）。凡例はフル桁のまま（formatReadout）。
  outputs: [{ key: 'volume', kind: 'histogram', priceFormat: abbreviate }],
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
