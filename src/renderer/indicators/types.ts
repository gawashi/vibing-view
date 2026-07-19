import type { Bar } from '@shared/types'

export type Source = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3'

export type Params = Record<string, number | string>

export type LineData = { time: number; value: number }

// MACD histogram + volume bars: a point that carries its own per-bar color (D-42/43).
export type HistPoint = { time: number; value: number; color?: string }

export type FieldDesc =
  | { key: string; kind: 'number'; label: string; min?: number; step?: number }
  | { key: string; kind: 'select'; label: string; options: string[] }
  | { key: string; kind: 'source'; label: string }
  | { key: string; kind: 'color'; label: string }

export type OutputMeta =
  | { key: string; kind: 'line' }
  | { key: string; kind: 'band'; between: [string, string] }
  | { key: string; kind: 'histogram' }

export type IndicatorModule = {
  type: string
  label: (p: Params) => string
  defaults: Params
  params: FieldDesc[]
  outputs: OutputMeta[]
  // Sub-pane vs. price-pane overlay. Default 'overlay' (ma/bb omit it). RSI/MACD/Volume = 'separate'.
  pane?: 'overlay' | 'separate'
  // Fixed vertical scale (RSI = {0,100}, D-45) wired via the line series' autoscaleInfoProvider.
  scale?: { min: number; max: number }
  // Horizontal guide lines + zone fill, declared as FUNCTIONS of Params (mirror `label`) so
  // live-editing RSI's overbought/oversold moves the drawn lines/zone (Landmine #1).
  guides?: (p: Params) => { value: number; color?: string }[]
  band?: (p: Params) => { from: number; to: number; color: string }
  // Per-instance crosshair readout (D-38, IND-01). `values` is keyed by this module's DRAW-output
  // keys (line/histogram), holding the value at the hovered bar (or latest bar for non-hover). A key
  // is ABSENT when that output has no value at that time — MUST guard (e.g. `v.macd?.toFixed(2) ?? '—'`).
  // Omit it → legend falls back to a single-value 2-decimal render (ma/bb/rsi).
  formatReadout?: (values: Record<string, number>, p: Params) => string
  compute: (bars: Bar[], p: Params) => Record<string, LineData[] | HistPoint[]>
}

export type IndicatorInstance = {
  id: string
  type: string
  params: Params
  colors: Record<string, string>
  visible: boolean
  // Always-on, user-immutable instance (Volume, D-34) — removeIndicator ignores it and its
  // legend hides the eye/gear/× affordances. ma/bb/rsi instances omit it (undefined = false).
  fixed?: boolean
}

// Collapse an aligned (leading-undefined) series into LineData, dropping the undefined gaps.
export function alignLine(bars: Bar[], aligned: Array<number | undefined>): LineData[] {
  const out: LineData[] = []
  for (let i = 0; i < aligned.length; i++) {
    const value = aligned[i]
    if (value === undefined) continue
    out.push({ time: bars[i].time, value })
  }
  return out
}

export function sourceValues(bars: Bar[], source: Source): number[] {
  switch (source) {
    case 'open': return bars.map((b) => b.open)
    case 'high': return bars.map((b) => b.high)
    case 'low': return bars.map((b) => b.low)
    case 'hl2': return bars.map((b) => (b.high + b.low) / 2)
    case 'hlc3': return bars.map((b) => (b.high + b.low + b.close) / 3)
    case 'close':
    default: return bars.map((b) => b.close)
  }
}
