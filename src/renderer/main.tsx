import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { parseHash } from '@shared/windowHash'
import { useAppStore } from '@/store'
import App from './App'
import { CompanyWindow } from './components/CompanyWindow'
import { ChartWindow } from './components/ChartWindow'
import { SymbolChartWindow } from './components/SymbolChartWindow'
import { EconomicCalendarWindow } from './components/EconomicCalendarWindow'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    // API 節約最優先: OHLCV data is cache-first + manual-refresh (遅延OK).
    //  - staleTime:Infinity → a *successful* query never auto-refetches (covered symbols reuse cache).
    //  - retryOnMount:false → an *errored* query (an out-of-plan symbol's 402) is NOT retried when
    //    the observer remounts, i.e. every time the user switches back to that timeframe. Without it,
    //    D↔W↔M round-trips on an out-of-plan symbol re-hit FMP on every switch. A failed (symbol,tf)
    //    now hits FMP at most once per session (key change / manual invalidate re-attempts).
    //  - retry:0 → don't re-attempt a failed fetch; an out-of-plan 402 is deterministic, so a retry
    //    just doubles the API hit and the error noise for no gain (manual refresh re-attempts).
    queries: { staleTime: Infinity, retry: 0, refetchOnWindowFocus: false, retryOnMount: false }
  }
})

// Satellite windows reuse this same bundle; the hash carries the target. When present, mount that
// standalone window instead of the full App (see src/shared/windowHash.ts).
const companySymbol = parseHash('company', window.location.hash)
const chartCellId = parseHash('chart', window.location.hash)
const symbolChartSymbol = parseHash('symbolChart', window.location.hash)
// 経済カレンダーは 1 つしか開かないので値に意味はない。有無だけ見る（週は renderer state — EC-09/EC-10）。
const isEconomic = parseHash('economic', window.location.hash) !== null

// Seed the symbol window's cell here, before the first render: this window gets its own fresh store
// (one 1x1 cell, no useWorkspaceSync), so setting it now means SymbolChartWindow never has to render
// a symbol-less frame.
if (symbolChartSymbol) useAppStore.getState().setActiveSymbol(symbolChartSymbol)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {companySymbol
        ? <CompanyWindow symbol={companySymbol} />
        : chartCellId
          ? <ChartWindow cellId={chartCellId} />
          : symbolChartSymbol
            ? <SymbolChartWindow symbol={symbolChartSymbol} />
            : isEconomic
              ? <EconomicCalendarWindow />
              : <App />}
    </QueryClientProvider>
  </React.StrictMode>
)
