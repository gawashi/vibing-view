# Architecture Research

**Domain:** Personal desktop charting app (TradingView alternative) — Windows, TypeScript + React, FMP data, permanent local cache, pluggable indicators, pluggable data providers
**Researched:** 2026-07-18
**Confidence:** HIGH (component boundaries, cache design, process split — patterns are well-established and cross-verified) / MEDIUM (exact FMP endpoint quirks, free-tier limits — verify empirically once a key is in hand)

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│  RENDERER (Chromium webview) — React + TypeScript, no direct disk/net    │
│                                                                            │
│  ┌───────────────┐  ┌────────────────────┐  ┌─────────────────────────┐ │
│  │ Layout/Grid    │  │ Chart Panel(s)      │  │ Watchlist / Symbol      │ │
│  │ (workspace)    │  │ - lightweight-charts│  │ Search UI               │ │
│  └───────┬───────┘  └──────────┬──────────┘  └────────────┬────────────┘ │
│          │                     │                           │              │
│          │           ┌─────────▼─────────┐                 │              │
│          │           │  Indicator Engine  │                 │              │
│          │           │  (pure TS, no IO)  │                 │              │
│          │           └─────────┬─────────┘                 │              │
│          └─────────────────────┼───────────────────────────┘              │
│                                 │  window.api.* (typed bridge)             │
└─────────────────────────────────┼──────────────────────────────────────────┘
                                   │ IPC (ipcRenderer.invoke / preload contextBridge)
┌─────────────────────────────────┼──────────────────────────────────────────┐
│  MAIN PROCESS (Node.js) — all IO, all secrets, no UI                       │
│                                 │                                          │
│  ┌───────────────┐   ┌─────────▼──────────┐   ┌─────────────────────────┐ │
│  │ IPC Handlers   │──▶│ Cache/Store Service │──▶│ Data-Provider Registry  │ │
│  │ (ipcMain.handle)│  │ (cache-first reads, │   │ (interface + FMP impl)  │ │
│  └───────────────┘   │  gap-fill, upsert)  │   └────────────┬────────────┘ │
│                       └─────────┬──────────┘                │              │
│                                 │                            │  HTTPS       │
│                       ┌─────────▼──────────┐                 ▼              │
│                       │  SQLite (better-   │        ┌─────────────────┐    │
│                       │  sqlite3)          │        │  FMP REST API   │    │
│                       │  bars / coverage / │        └─────────────────┘    │
│                       │  layouts / watchl. │                               │
│                       └────────────────────┘                               │
│  ┌─────────────────────────────────────────┐                               │
│  │ safeStorage — encrypted FMP API key      │                               │
│  └─────────────────────────────────────────┘                               │
└──────────────────────────────────────────────────────────────────────────┘
```

This is drawn Electron-shaped because it is the cleanest fit for "all logic in TypeScript" (see *Electron vs Tauri process split* below), but every box maps onto Tauri too — see that section for the mapping. The **component boundaries and data-flow direction are the same regardless of which shell wins in STACK.md.**

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Data-Provider layer | Fetch OHLCV + symbol search from an external API; normalize to canonical shape | `IDataProvider` interface + `FmpProvider` class; lives main-side, holds the API key, does the HTTP call |
| Cache/Store service | Single source of truth for bars; decides what's already cached vs what to fetch; upserts provider responses; aggregates D→W/M | `CacheService` wrapping better-sqlite3; the *only* thing the rest of the app talks to for bars |
| SQLite database | Durable storage: bars, fetch-coverage ranges, layouts, watchlists, settings | better-sqlite3 (Electron) or sqlx via tauri-plugin-sql (Tauri) |
| IPC bridge | Narrow, typed request/response surface between renderer and main | `contextBridge.exposeInMainWorld` + `ipcMain.handle`/`ipcRenderer.invoke` |
| Indicator Engine | Pure functions: bars + params → named output series; registry for pluggability | TS module, no IO, runs in renderer (or a Web Worker for heavy recompute) |
| Chart/Render layer | Owns one `lightweight-charts` instance per chart panel; maps canonical bars/series → chart API calls | React component wrapping `createChart()`; one candlestick series + N overlay/pane series |
| Layout/Workspace | Grid of chart panels + their configs (symbol, timeframe, indicator instances) as one serializable unit | React state tree, persisted as JSON via Cache/Store |
| Watchlist | Named list(s) of symbols, independent of any single chart | Simple table, persisted via Cache/Store |

## Recommended Project Structure

```
src/
├── main/                        # Electron main process (Node) — ALL IO lives here
│   ├── ipc/                     # ipcMain.handle registrations, one file per domain
│   │   ├── bars.ipc.ts
│   │   ├── symbols.ipc.ts
│   │   ├── layouts.ipc.ts
│   │   ├── watchlists.ipc.ts
│   │   └── settings.ipc.ts
│   ├── providers/                # Data-provider abstraction (seam #2)
│   │   ├── data-provider.interface.ts
│   │   ├── fmp/
│   │   │   ├── fmp-provider.ts
│   │   │   ├── fmp-endpoints.ts   # per-timeframe endpoint mapping
│   │   │   └── fmp-normalize.ts   # FMP JSON -> canonical Bar[]
│   │   └── provider-registry.ts   # id -> IDataProvider, active provider selection
│   ├── cache/                    # Persistent cache/store layer
│   │   ├── db.ts                 # better-sqlite3 connection + migrations
│   │   ├── schema.sql
│   │   ├── bars-repository.ts    # upsert/read bars, coverage tracking
│   │   ├── coverage.ts           # interval-merge logic for gap detection
│   │   ├── aggregate.ts          # daily -> weekly/monthly rollups
│   │   ├── layouts-repository.ts
│   │   └── watchlists-repository.ts
│   ├── secrets.ts                 # safeStorage wrapper for the FMP API key
│   └── main.ts                    # app lifecycle, BrowserWindow creation
├── preload/
│   └── preload.ts                 # contextBridge surface: window.api.*
├── renderer/                      # React app — NO direct disk/network access
│   ├── charts/
│   │   ├── ChartPanel.tsx          # owns one lightweight-charts instance
│   │   ├── useChartData.ts         # calls window.api.bars.get, feeds engine
│   │   └── chart-theme.ts          # dark theme tokens for lightweight-charts
│   ├── indicators/                 # Indicator Engine (seam #1) — pure TS, portable
│   │   ├── indicator.types.ts      # IndicatorDefinition, params schema, output spec
│   │   ├── registry.ts             # register()/get()/list() — the plugin point
│   │   ├── sma.ts / ema.ts
│   │   ├── bollinger-bands.ts
│   │   ├── volume.ts
│   │   ├── rsi.ts
│   │   └── macd.ts
│   ├── layout/
│   │   ├── Workspace.tsx           # grid of ChartPanels
│   │   └── layout.types.ts
│   ├── watchlist/
│   ├── settings/                    # API key entry UI (never touches the raw key after save)
│   └── app-shell/                   # dark theme, top-level routing/state
├── shared/                          # types shared between main and renderer (no IO)
│   ├── bar.types.ts                 # canonical Bar, Timeframe, SymbolRef
│   └── ipc-contract.ts              # request/response types for every IPC channel
└── ...
```

### Structure Rationale

- **`main/providers/` and `renderer/indicators/` are the two abstraction seams** the project explicitly asked for. They are deliberately isolated in their own directories with an `*.interface.ts`/`*.types.ts` + registry pattern each, so "add a new indicator" or "add a new data source" is additive (new file + one registration call), never a change to chart/cache code.
- **`shared/` holds only types**, never logic — this is what lets the same `Bar` shape flow from FMP → cache → IPC → indicator engine → chart without translation layers at each hop.
- **Everything with IO (HTTP, SQLite, filesystem, the API key) lives in `main/`.** The renderer never imports `better-sqlite3` or does `fetch()` to FMP directly. This is not just a style preference — SQLite native modules cannot run in a sandboxed renderer, and keeping the API key main-side prevents it ever appearing in renderer devtools/network tab or in a compromised third-party script.
- **Indicator Engine lives in the renderer**, not main, because it is pure computation over data already in memory and needs to be interactive (drag an RSI-period slider → recompute instantly, no IPC round-trip). It has zero IO dependencies, so it is trivially unit-testable in isolation and could later be moved to a Web Worker without touching its API.

## Architectural Patterns

### Pattern 1: Provider interface + normalization boundary (seam #2)

**What:** A single `IDataProvider` interface that every provider (FMP now, others later) implements. All provider-specific quirks (endpoint-per-timeframe, field names, symbol formats, rate limits) are absorbed inside the provider's own module and never leak past its normalize step.

```typescript
// shared/bar.types.ts
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '1D' | '1W' | '1M';

export interface Bar {
  t: number;   // unix seconds, UTC, bar OPEN time (canonical — pick one, document it)
  o: number; h: number; l: number; c: number; v: number;
}

export interface SymbolRef {
  symbol: string;          // canonical ticker, e.g. "AAPL", "BTCUSD"
  assetClass: 'stock' | 'crypto';
  exchange?: string;
  name?: string;
}

// main/providers/data-provider.interface.ts
export interface IDataProvider {
  readonly id: string;                       // 'fmp'
  readonly supportedTimeframes: Timeframe[];  // provider declares what it can natively serve
  searchSymbols(query: string): Promise<SymbolRef[]>;
  getBars(symbol: SymbolRef, timeframe: Timeframe, range: { from: number; to: number }): Promise<Bar[]>;
}
```

**When to use:** Immediately — this interface is the contract the Cache/Store service depends on, so it must exist before real fetching is wired up. `1W`/`1M` are listed as timeframes the *system* supports, but no provider needs to implement them natively (see Pattern 3 — they're derived).

**Trade-offs:** FMP's real API is endpoint-per-granularity (separate `1min`, `5min`, `15min`, `1hour`, and a distinct EOD/daily endpoint) rather than one parameterized endpoint — that mapping (`Timeframe → FMP endpoint + query params`) is entirely inside `fmp-endpoints.ts` and `fmp-normalize.ts`, so a future provider with a different shape (e.g. one unified `?interval=` param) doesn't require touching the interface, only writing its own mapping file.

### Pattern 2: Cache-first read path with a coverage ledger

**What:** The Cache/Store service is the *only* thing anything else in the app talks to for bars. It never lets a caller talk to a provider directly. Reads always go through this sequence:

1. Caller asks `CacheService.getBars(symbol, timeframe, range)`.
2. Service checks a **coverage table** (merged `[from, to]` intervals already known-complete for this `symbol+timeframe`) — cheap, no scan of the `bars` table itself.
3. If `range` is fully covered → read straight from SQLite `bars`, return.
4. If partially/not covered → compute the missing sub-range(s), call `provider.getBars()` only for those, upsert results into `bars`, extend the coverage ledger, then re-read from SQLite and return.
5. SQLite is always the thing that's actually returned from — never provider data handed straight through — so cache and "live" reads can never disagree.

```sql
-- schema.sql
CREATE TABLE bars (
  provider   TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  timeframe  TEXT NOT NULL,      -- native timeframes only: 1m/5m/15m/1h/1D (never 1W/1M — those are derived)
  ts         INTEGER NOT NULL,   -- unix seconds, bar open time
  open REAL, high REAL, low REAL, close REAL, volume REAL,
  PRIMARY KEY (provider, symbol, timeframe, ts)
);

CREATE TABLE bar_coverage (
  provider   TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  timeframe  TEXT NOT NULL,
  range_from INTEGER NOT NULL,
  range_to   INTEGER NOT NULL
  -- merged, non-overlapping intervals per (provider,symbol,timeframe); maintained by coverage.ts
);

CREATE TABLE layouts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, layout_json TEXT NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE watchlists (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, symbols_json TEXT NOT NULL, updated_at INTEGER NOT NULL
);
```

**When to use:** From day one of the cache layer — this is the mechanism that satisfies "never re-fetch data already fetched," which is the project's stated primary cost-control goal. `INSERT OR IGNORE`/upsert on the composite key makes re-fetch-on-overlap idempotent even if the coverage ledger and actual rows ever drift.

**Trade-offs:** A coverage ledger is one extra table and a bit of interval-merge logic (~50 lines), but it's what avoids two bad alternatives: (a) scanning all rows to find "holes" on every read (slow, and ambiguous — a real market holiday gap and a *missing-data* gap look identical from rows alone), or (b) trusting "do we have *any* row in this range" as a proxy for completeness (silently wrong on partial fetches, e.g. an API error mid-page).

### Pattern 3: Native timeframes stored, derived timeframes computed on read

**What:** Only fetch and store what FMP actually serves as distinct series: intraday minutes/hours and daily EOD. Weekly and Monthly are **never fetched from FMP and never separately cached with their own coverage rows** — they are aggregated from cached daily bars at read time (group by ISO week / calendar month, `open` = first bar's open, `close` = last bar's close, `high`/`low` = max/min, `volume` = sum).

```typescript
// main/cache/aggregate.ts
export function aggregateDailyTo(bars: Bar[], target: '1W' | '1M'): Bar[] {
  // group daily bars into weekly/monthly buckets, roll up OHLCV
}
```

**When to use:** Always, for W/M. It is the direct answer to "deriving weekly/monthly from daily where sensible" — sensible here because FMP's daily endpoint already gives up to 5 years of history in one call, so there is no fetch-volume reason to ever hit a dedicated weekly/monthly endpoint even if FMP has one.

**Trade-offs:** Aggregation on every read is cheap (daily bar counts are small — a 20-year daily history is ~5,000 rows) so it does not need to be materialized/cached separately; if profiling later shows otherwise, the aggregate result can be memoized in-process (not in SQLite) keyed by `(symbol, range)` without changing the interface.

## Data Flow

### Request Flow (user picks a symbol/timeframe)

```
[User selects AAPL, 1D]
    ↓
[ChartPanel/useChartData (renderer)] → window.api.bars.get('AAPL','1D',{from,to})
    ↓ IPC invoke
[bars.ipc.ts handler (main)] → CacheService.getBars(...)
    ↓
[coverage check] → gap? → [FmpProvider.getBars(missing range)] → HTTPS → FMP
    ↓                                                              ↓
[upsert into SQLite bars + extend coverage] ←────────────────────┘
    ↓
[read merged range back from SQLite] → return Bar[] over IPC
    ↓
[renderer: candlestick series.setData(bars)]
    ↓
[Indicator Engine: compute(bars, params) for each active indicator instance]
    ↓
[overlay series / pane series .setData(...) on the same lightweight-charts instance]
```

### State Management

```
[Workspace state (React, renderer)]
    - active layout (grid of chart panel configs)
    - per-panel: symbol, timeframe, indicator instances (id + params + paneIndex)
    ↓ (on explicit Save / on layout change, debounced)
window.api.layouts.save(layoutJson)
    ↓ IPC
[layouts.ipc.ts] → SQLite `layouts` table
    ↓ (on app start / "load layout")
window.api.layouts.get(id) → hydrates Workspace state → each ChartPanel re-requests its own bars
```

### Key Data Flows

1. **Bars (cache-first):** UI never fetches from FMP directly; it always asks the Cache/Store service, which decides whether a network call is even needed. This is the flow that guarantees the "never re-fetch" requirement holds regardless of what UI code does.
2. **Indicator recompute:** Purely renderer-local. Changing an indicator's params (e.g. RSI period 14→21) never touches IPC or SQLite — it re-runs `compute()` over bars already held in memory. Only *adding/removing/reconfiguring* an indicator instance touches persistence, and only because the layout changed.
3. **Layout/watchlist persistence:** One-directional snapshot save (whole JSON blob per layout/watchlist), not incremental sync — simple, and appropriate at personal/small-group scale (no concurrent multi-writer concern).
4. **Symbol search:** Same cache-first shape could apply (search results are cacheable per query for a short TTL) but is lower value; acceptable to hit FMP directly through the provider on every search keystroke (debounced), since it's a cheap, low-volume endpoint distinct from OHLCV pulls.

## Electron vs Tauri: main-vs-renderer process split

This is a STACK.md decision, but the architecture above is written to hold for either. Confidence: HIGH that Electron is the structurally simpler fit for this project *given the TS+React constraint*; Tauri is viable but shifts more of the "shell" into Rust unless you deliberately keep it thin.

**Electron (all logic stays TypeScript):**
- Main process (Node, full OS access): providers, cache/store, SQLite (`better-sqlite3`), the FMP API key (encrypted at rest via `safeStorage`, main-process-only).
- Preload script: `contextBridge.exposeInMainWorld('api', {...})` — one named method per IPC channel (never expose raw `ipcRenderer`), each backed by `ipcRenderer.invoke`.
- Main-side: `ipcMain.handle(channel, ...)` re-validates every argument (defense in depth — preload validation is not sufcient on its own).
- Renderer: React + `lightweight-charts` + Indicator Engine, zero Node access, `nodeIntegration: false`, `contextIsolation: true`.
- Native module caveat: `better-sqlite3` must be rebuilt for Electron's Node ABI (`@electron/rebuild`) on every Electron version bump; Node 22+'s built-in `node:sqlite` is an alternative worth checking against Electron's bundled Node version to avoid native-module rebuild friction entirely.
- Multi-window: a single `BrowserWindow` hosting an internal React grid layout is enough for "multiple charts/layouts" (v1) — extra OS-level windows are not required and add session/state-sync complexity better deferred.

**Tauri (if chosen instead):**
- Rust side stays a thin shell: register `tauri-plugin-sql` (SQLite via sqlx) and run migrations in Rust, but write no custom `#[tauri::command]` business logic — all queries execute from TypeScript via `Database.load('sqlite:...')` / `.execute()` / `.select()`.
- Data-provider fetch (FMP HTTP calls) can run directly in the webview via `fetch()` (Tauri's webview has network access like a browser, gated by CSP/`http` scope allowlist), so the provider layer stays TypeScript too — no need to write providers in Rust.
- API key storage: use `tauri-plugin-stronghold` or OS keychain via a plugin rather than Electron's `safeStorage`; if the fetch happens in the webview itself (not a Rust command), the key necessarily passes through the frontend bundle at fetch time — this is a materially weaker isolation boundary than Electron's main-process-only key handling, and is the main architectural reason to lean Electron here.
- Bundle size / RAM win is real but Windows-specific benefit is diluted: Tauri on Windows uses WebView2, which is itself Chromium-based, so the "smaller than Electron" story is mostly about disk/installer size and idle RAM, not rendering engine differences.

**Recommendation for STACK.md to weigh:** Electron is the lower-friction choice here specifically because it lets the *entire* provider + cache + indicator + chart stack be one language (TypeScript) with the API key never leaving a privileged Node process — matching this project's "TS + React" constraint and its API-key-security concern (shared keys among a small group) more directly than Tauri's Rust-thin-shell pattern does.

## Scaling Considerations

This is a personal/small-group app (explicitly out of scope: auth, multi-tenant, public distribution), so "scaling" here means *data volume and API-quota* pressure, not user count.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1 user, few symbols, FMP free tier | Cache-first path + coverage ledger is already sufficient; SQLite file stays small (a few MB per symbol/timeframe combination) |
| Small group (a few users, own FMP keys), many symbols/watchlists, daily use | No architectural change needed — each install has its own SQLite file and its own key; nothing shared or centralized. Add a lightweight per-provider request queue/backoff in the provider layer so free-tier rate limits degrade gracefully (retry-after, surfaced as a UI toast) instead of erroring the whole panel |
| Long history × many intraday symbols (1m bars across dozens of tickers, years back) | SQLite with a composite PK on `(provider, symbol, timeframe, ts)` handles millions of rows fine; if minute-bar storage ever becomes the bottleneck, prune/compact intraday granularities older than N months while keeping daily+ forever (daily bars are what weekly/monthly derive from, so daily must never be pruned) |

### Scaling Priorities

1. **First real constraint: FMP free-tier rate/volume limits**, not local storage or rendering. Design the provider layer's request queue and error types (`ProviderRateLimitError` distinct from `ProviderAuthError`/`ProviderNotFoundError`) early so the free-tier ceiling degrades UI gracefully rather than crashing panels — this is explicitly called out as a risk in PROJECT.md.
2. **Second: intraday storage growth** if 1m data across many symbols/years accumulates — addressed later, if needed, by pruning fine-grained intraday history while keeping daily bars (from which W/M are always derivable) permanently.

## Anti-Patterns

### Anti-Pattern 1: Letting the renderer fetch from FMP or open SQLite directly

**What people do:** Call `fetch('https://financialmodelingprep.com/...')` or open a SQLite connection straight from React/renderer code "to save an IPC hop."
**Why it's wrong:** Puts the API key in the renderer (visible in devtools, at risk from any injected script), bypasses the cache-first path entirely (defeats the "never re-fetch" requirement), and native SQLite bindings generally cannot run in a sandboxed renderer anyway.
**Do this instead:** Renderer only ever calls `window.api.*`; all HTTP and DB access is main-process-only, reached through the Cache/Store service.

### Anti-Pattern 2: Building the indicator system as chart-library-specific code

**What people do:** Hard-code `if (indicator === 'RSI') { ... lightweight-charts-specific series creation and math inline ... }` inside the chart component.
**Why it's wrong:** Directly defeats the stated requirement ("new indicator system so new indicators can be added later") — every new indicator would require touching chart rendering code, and swapping the charting library later would mean rewriting every indicator's math, not just its rendering glue.
**Do this instead:** Indicator math (`compute(bars, params) → named series`) lives in `renderer/indicators/`, completely ignorant of `lightweight-charts`; the `ChartPanel` component is the only place that knows how to turn a named series into an `addSeries(...)` call (line for overlays, histogram/line in `paneIndex: N` for RSI/MACD/Volume).

### Anti-Pattern 3: One monolithic "fetch everything visible" call with no coverage tracking

**What people do:** On every pan/zoom, just re-request the whole visible range from the provider and upsert it, relying on `INSERT OR IGNORE` alone to avoid duplicate storage.
**Why it's wrong:** Avoids duplicate *storage* but not duplicate *network calls* — every pan/zoom re-hits FMP even for ranges already fully cached, which is exactly the API-cost problem the project is trying to avoid.
**Do this instead:** The coverage ledger (Pattern 2) makes "is this range already fully cached" an O(few rows) lookup, so only genuinely missing sub-ranges ever reach the provider.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| FMP REST API | `FmpProvider implements IDataProvider`; HTTPS from main process only, `?apikey=` query param appended by the provider, never by renderer code | Distinct endpoints per intraday granularity (1min/5min/15min/1hour) plus a separate daily/EOD endpoint and separate symbol-search endpoints; free tier has volume/rate limits that must degrade gracefully, not crash |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Renderer ↔ Main | `window.api.*` (contextBridge) → `ipcRenderer.invoke` → `ipcMain.handle`, promise-based request/response | No push/streaming channel needed — no realtime requirement, so simple request/response IPC is sufficient; re-validate all args main-side even though preload also validates |
| Cache/Store ↔ Data-Provider | Direct in-process TS calls (both live in main) | Cache/Store never bypasses the provider interface, even though they're in the same process — keeps the seam real and swappable, not just conceptual |
| ChartPanel ↔ Indicator Engine | Direct in-process TS calls (both live in renderer) | `ChartPanel` passes `bars` + the active `IndicatorInstance[]` to the engine, gets back named series per instance, maps each to a `lightweight-charts` series/pane |
| Workspace ↔ Layouts persistence | `window.api.layouts.*` | Debounced save on layout change; explicit "Save Layout" action is fine for v1 (avoid autosave races with no conflict resolution needed at this scale) |

## Suggested Build Order

Ordering reflects hard dependencies — each stage should be independently verifiable before the next begins:

1. **Data-Provider layer** (`IDataProvider` + `FmpProvider`) — standalone, unit-testable with recorded FMP responses, no UI, no Electron shell needed yet. Nothing else can be honestly tested without real bars flowing.
2. **Cache/Store layer** (SQLite schema, coverage ledger, cache-first `getBars`, D→W/M aggregation) wrapping the provider from (1). Verifiable via scripts/tests alone: fetch a range, refetch overlapping range, assert no duplicate network call.
3. **Shell + IPC wiring** (Electron main/preload/renderer scaffold, `window.api.bars.*`, API key entry + `safeStorage`) — plugs (1)+(2) behind IPC. This is the first point a real window exists.
4. **Chart/Render layer, no indicators yet** — symbol search, timeframe switch, a single candlestick chart fed via `window.api.bars.get`. Validates the full pipeline end-to-end (UI → IPC → cache → provider → render) before adding any indicator complexity.
5. **Indicator Engine** (interface + registry) + first indicators: Volume (pane), MA/BB (overlay), RSI, MACD (pane) — layered onto the now-working single chart. This is where seam #1 gets proven with 2+ real indicators of both placement kinds (overlay vs pane), not just one.
6. **Layout system** (multi-chart grid) + **Watchlist** + persistence (save/restore to SQLite) — depends on chart+indicator config being stable enough to serialize; building this before (5) risks having to redesign the serialized shape once indicator instances exist.
7. **Polish pass**: dark theme across all panes, crosshair sync across multiple charts in a layout, free-tier rate-limit/backoff surfaced in the UI (toast/badge, not a crash), settings UI hardening.

Steps 1–2 have no UI dependency and could be built and tested in isolation before any Electron/React scaffolding exists, which is a useful place to de-risk the FMP integration (endpoint shapes, free-tier limits, symbol/timeframe normalization) early and cheaply.

## Sources

- [Lightweight Charts (TradingView) — official docs, panes/multi-pane and custom-series-plugin architecture](https://github.com/tradingview/lightweight-charts) — HIGH confidence, official library docs (this is TradingView's own open-source charting library, so it is a strong default rendering-layer choice for a "TradingView alternative")
- [Lightweight Charts — moving-average / indicator tutorial pattern (bars → compute → series)](https://github.com/tradingview/lightweight-charts/blob/master/website/tutorials/analysis-indicators.mdx) — HIGH confidence, official
- FMP developer docs (historical EOD, per-granularity intraday endpoints, symbol/name search) — MEDIUM confidence, official vendor docs surveyed via search summaries rather than the raw pages directly; verify exact endpoint/param names once an FMP key is available
- Electron official docs: `safeStorage`, `contextBridge`, IPC security tutorial — HIGH confidence, official
- Community synthesis on Electron+SQLite (`better-sqlite3` main-process-only, native module rebuild caveat, `node:sqlite` alternative) — MEDIUM confidence, cross-corroborated across multiple independent sources
- Tauri `tauri-plugin-sql` official docs/reference (JS-first SQL, thin-Rust-shell pattern) — HIGH confidence, official
- Electron vs Tauri 2026 comparisons (bundle size, WebView2-is-Chromium-on-Windows nuance) — MEDIUM confidence, multiple blog sources broadly agreeing; this is directional context for STACK.md's own decision, not load-bearing for this architecture document
- OHLCV/SQLite caching pattern synthesis (composite-key upsert, coverage/gap tracking, daily→weekly/monthly derivation) — MEDIUM confidence, pattern cross-corroborated across several independent open-source implementations, not a single canonical spec

---
*Architecture research for: personal desktop TradingView-alternative charting app*
*Researched: 2026-07-18*
