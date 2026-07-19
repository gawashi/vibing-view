import { create } from 'zustand'

type AppState = {
  activeSymbol: string | null
  setActiveSymbol: (symbol: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeSymbol: null,
  setActiveSymbol: (symbol) => set({ activeSymbol: symbol })
}))
