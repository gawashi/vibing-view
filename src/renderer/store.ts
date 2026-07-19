import { create } from 'zustand'
import { registry } from './indicators/registry'
import type { IndicatorInstance, Params } from './indicators/types'

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
}

export const useAppStore = create<AppState>((set, get) => ({
  activeSymbol: null,
  setActiveSymbol: (symbol) => set({ activeSymbol: symbol }),

  indicators: [],
  addIndicator: (type) => {
    const module = registry[type]
    if (!module) return
    const color = PALETTE[get().indicators.length % PALETTE.length]
    const colors: Record<string, string> = {}
    for (const output of module.outputs) colors[output.key] = color
    const instance: IndicatorInstance = {
      id: String(nextId++),
      type,
      params: { ...module.defaults },
      colors,
      visible: true
    }
    set((state) => ({ indicators: [...state.indicators, instance] }))
  },
  removeIndicator: (id) => set((state) => ({ indicators: state.indicators.filter((i) => i.id !== id) })),
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
