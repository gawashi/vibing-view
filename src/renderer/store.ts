import { create } from 'zustand'
import { registry } from './indicators/registry'
import type { IndicatorInstance, Params } from './indicators/types'

// Crosshair readout injected into each pane's legend (D-38/39/40). Keyed by instance id for
// per-output indicator values (keyed by draw-output key), plus a reserved `price` key holding the
// price-pane OHLC. Multi-value by design so MACD-style 3-value readouts are a drop-in (IND-01).
export type OhlcValues = { open: number; high: number; low: number; close: number }
export type InstReadout = Record<string, number>
export type CrosshairValues = Record<string, OhlcValues | InstReadout>

// D-30: fixed 6-hue dark-theme palette, round-robin assigned by add order. Disjoint from candle
// colors, the app accent, and destructive — see 03-UI-SPEC.md Color section.
export const PALETTE = ['#F5A623', '#A78BFA', '#2DD4BF', '#F472B6', '#FACC15', '#38BDF8']

let nextId = 1 // module-level counter (no Date/random) — JSON-stable ids for P5 persistence

type AppState = {
  activeSymbol: string | null
  setActiveSymbol: (symbol: string) => void
  indicators: IndicatorInstance[]
  addIndicator: (type: string) => void
  removeIndicator: (id: string) => void
  toggleVisible: (id: string) => void
  updateParams: (id: string, patch: Params) => void
  setColor: (id: string, outputKey: string, color: string) => void
  crosshair: CrosshairValues
  setCrosshair: (values: CrosshairValues) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  activeSymbol: null,
  setActiveSymbol: (symbol) => set({ activeSymbol: symbol }),

  crosshair: {},
  setCrosshair: (values) => set({ crosshair: values }),

  // D-34: Volume is always present, non-removable, not addable — seeded once, same shape as addIndicator.
  indicators: [
    { id: String(nextId++), type: 'volume', params: {}, colors: {}, visible: true, fixed: true }
  ],
  addIndicator: (type) => {
    const module = registry[type]
    if (!module) return
    const base = get().indicators.length
    const colors: Record<string, string> = {}
    // Multi-line-no-band modules (MACD: macd+signal, no band) get CONSECUTIVE hues so the two lines
    // are distinguishable; derived from outputs structure, never inst.type. ma/rsi (single line) and
    // bb (has a band) keep the single-hue path. Non-line outputs (histogram) get a placeholder — its
    // real per-bar colors come from compute, so the palette value is unused.
    const lineCount = module.outputs.filter((o) => o.kind === 'line').length
    const hasBand = module.outputs.some((o) => o.kind === 'band')
    if (lineCount > 1 && !hasBand) {
      let n = 0
      for (const output of module.outputs) {
        colors[output.key] =
          output.kind === 'line' ? PALETTE[(base + n++) % PALETTE.length] : PALETTE[base % PALETTE.length]
      }
    } else {
      const color = PALETTE[base % PALETTE.length]
      for (const output of module.outputs) colors[output.key] = color
    }
    const instance: IndicatorInstance = {
      id: String(nextId++),
      type,
      params: { ...module.defaults },
      colors,
      visible: true
    }
    set((state) => ({ indicators: [...state.indicators, instance] }))
  },
  removeIndicator: (id) => set((state) => ({
    indicators: state.indicators.filter((i) => i.id !== id || i.fixed)
  })),
  toggleVisible: (id) => set((state) => ({
    indicators: state.indicators.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i))
  })),
  updateParams: (id, patch) => set((state) => ({
    indicators: state.indicators.map((i) => (i.id === id ? { ...i, params: { ...i.params, ...patch } } : i))
  })),
  setColor: (id, outputKey, color) => set((state) => ({
    indicators: state.indicators.map((i) =>
      i.id === id ? { ...i, colors: { ...i.colors, [outputKey]: color } } : i
    )
  }))
}))
