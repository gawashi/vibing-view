import type { Bar } from '@shared/types'

export type Source = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3'

export type Params = Record<string, number | string>

export type LineData = { time: number; value: number }

export type FieldDesc =
  | { key: string; kind: 'number'; label: string; default: number; min?: number; step?: number }
  | { key: string; kind: 'select'; label: string; options: string[]; default: string }
  | { key: string; kind: 'source'; label: string; default: Source }
  | { key: string; kind: 'color'; label: string }

export type OutputMeta =
  | { key: string; kind: 'line'; defaultWidth?: number }
  | { key: string; kind: 'band'; between: [string, string] }

export type IndicatorModule = {
  type: string
  label: (p: Params) => string
  defaults: Params
  params: FieldDesc[]
  outputs: OutputMeta[]
  compute: (bars: Bar[], p: Params) => Record<string, LineData[]>
}

export type IndicatorInstance = {
  id: string
  type: string
  params: Params
  colors: Record<string, string>
  visible: boolean
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
