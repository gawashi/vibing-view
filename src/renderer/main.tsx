import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { parseCompanySymbol } from '@shared/companyWindow'
import App from './App'
import { CompanyWindow } from './components/CompanyWindow'
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

// Company-info windows reuse this same bundle; the hash carries the target symbol. When present,
// mount the standalone CompanyWindow instead of the full App (see src/shared/companyWindow.ts).
const companySymbol = parseCompanySymbol(window.location.hash)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {companySymbol ? <CompanyWindow symbol={companySymbol} /> : <App />}
    </QueryClientProvider>
  </React.StrictMode>
)
