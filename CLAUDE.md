# Vibing View

## Project

**A charting app (a TradingView alternative).**

A Windows desktop app (TypeScript + React) that provides TradingView's paid features **with no limits, no ads, and no login required**. It fetches US stock and crypto price data from FMP (Financial Modeling Prep), caches it permanently on local disk, and displays candlesticks plus **freely overlaid** indicators.

**Core Value:** Being able to lay out as many charts as you want and overlay indicators without limits, right on your own machine. This is not a full reproduction of TradingView.

## Constraints

- **Tech stack**: TypeScript + React
- **Platform**: Windows desktop app (Electron)
- **Data source**: FMP — but abstract the provider layer so other APIs can be added later
- **Data freshness**: Handles minute/hour bars too, but delay is OK. No real-time streaming needed
- **Cost**: FMP free tier during development → paid tier for real use. Design so the free-tier rate/fetch limits don't break it
- **Persistence**: Fetched price data is stored permanently on local disk and never re-fetched (**saving API calls is the top priority**)
- **Distribution**: Small circle of close users. Each installation has the user configure their own API key

## Architecture

- Define a `DataSourceAdapter` interface (`getOHLCV(symbol, timeframe, range)` / `searchSymbols(query)`, etc.) and make FMP the first (and for v1, only) implementation.
- Route all fetches through **adapter → TanStack Query → SQLite read-through cache**. Swapping the adapter later must not touch the cache or query layers.
- SQLite is the source of truth for "have we already fetched this symbol+timeframe+range". On a hit, skip the network entirely. **Build the read-through logic before building any UI** (to avoid accidents like re-fetching on every chart mount).
- When an intraday endpoint is rate-limited or unavailable on the current tier, don't crash — surface a "no more requests today" state per timeframe.
- Indicator math lives in **hand-written TS modules**. `trading-signals` (actively maintained) is for cross-checking during development.
- Small config data — layouts, watchlists, window state — goes in JSON under `app.getPath('userData')` (or electron-store), not SQLite. Keep them separate: **SQLite = fetched-data cache (OHLCV, company profiles, economic calendar/indicators/treasury curves) / JSON = user preferences**.

## Rules

- **Pin Vite at `^7`.** electron-vite@5 does not declare Vite 8 as a peer.
- **better-sqlite3 must be rebuilt against Electron's Node ABI** (not system Node). electron-builder's install step / an `@electron/rebuild` postinstall handles this. Forgetting it is the #1 source of "cannot find module" / native-binding-mismatch errors.
- `technicalindicators` / `react-financial-charts` are unmaintained. Don't use them.
