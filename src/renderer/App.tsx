import React, { useEffect } from 'react'
import { api } from './api'
import { Chart } from './components/Chart'
import { SearchBar } from './components/SearchBar'
import { SettingsDialog } from './components/SettingsDialog'
import { useAppStore } from './store'

export default function App(): React.JSX.Element {
  const activeSymbol = useAppStore((s) => s.activeSymbol)
  const setActiveSymbol = useAppStore((s) => s.setActiveSymbol)
  useEffect(() => {
    void api.settings.getLastSymbol().then((last) => setActiveSymbol(last ?? 'AAPL')) // D-06/D-07
  }, [setActiveSymbol])
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-4 border-b border-border bg-card px-8 py-4">
        <span className="text-2xl font-semibold">{activeSymbol ?? '—'}</span>
        <div className="ml-auto flex items-center gap-4">
          <SearchBar />
          <SettingsDialog />
        </div>
      </header>
      <main className="flex-1">
        {activeSymbol
          ? <Chart symbol={activeSymbol} />
          : <div className="p-6 text-muted-foreground">Search a symbol to begin.</div>}
      </main>
    </div>
  )
}
