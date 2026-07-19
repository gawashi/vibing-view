# Roadmap: 自作チャートアプリ（TradingView 代替 / trading-view）

## Overview

This roadmap delivers a personal Windows desktop charting app that replaces TradingView's free tier without its caps. It starts with one thin end-to-end vertical slice — search a symbol → fetch via the FMP provider → persist to a local cache → render a candlestick chart — that stands up the whole pipeline and both abstraction seams (data-provider + indicator system) from day one. Each later phase adds a real user-facing capability on top of that spine: full timeframes with free-tier resilience, unlimited configurable overlay indicators, TradingView-correct pane indicators with a synced crosshair, and finally multi-chart layouts + persistence + watchlist — the v1 goal line where the workspace becomes "yours" and restores itself on launch.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Core Pipeline Slice** - Search a symbol and render its candlestick chart from a secure, cached FMP pipeline
- [ ] **Phase 2: Timeframes & Free-Tier Resilience** - Switch across all timeframes and pan/zoom while degrading gracefully on FMP free-tier limits
- [ ] **Phase 3: Indicator Engine & Overlays** - Freely add unlimited configurable moving-average and Bollinger Band overlays via a pluggable indicator system
- [ ] **Phase 4: Pane Indicators, Crosshair & Correct Math** - Add Volume/RSI/MACD sub-panes with a synced crosshair and TradingView-matching values
- [ ] **Phase 5: Layouts, Persistence & Watchlist** - Arrange multi-chart grids, manage a watchlist, and save/auto-restore named layouts (v1 goal line)

## Phase Details

### Phase 1: Core Pipeline Slice

**Goal**: A user can search a US stock or crypto symbol and see its candlestick chart rendered from a locally cached, provider-abstracted FMP pipeline, with the API key held securely in the main process.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-05, CHART-01, CHART-05
**Success Criteria** (what must be TRUE):

  1. User can search a US stock or crypto ticker/name and select it as the active symbol.
  2. User sees a daily candlestick chart render for the selected symbol.
  3. Reopening a symbol/range already fetched renders from the local cache with no new FMP request (cache-first coverage check; only missing ranges are fetched).
  4. Fetching and rendering work behind the `IDataProvider` seam (FMP is the only implementation) so a new provider is additive.
  5. The FMP API key is entered once, stored in the main process, and never appears in renderer/devtools state or in UI-visible network calls; the app renders in a dark theme.

**Plans**: TBD
**UI hint**: yes

### Phase 2: Timeframes & Free-Tier Resilience

**Goal**: A user can view any symbol across all supported timeframes and pan/zoom through history, with the app detecting FMP free-tier limits and degrading gracefully instead of breaking.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: CHART-02, CHART-03, DATA-04
**Success Criteria** (what must be TRUE):

  1. User can switch a chart between 1m / 5m / 15m / 1h / D / W / M; weekly and monthly render even when FMP serves only daily (derived from cached daily bars).
  2. User can pan and zoom along the time axis, and panning into uncached history fetches only the missing sub-range, not a full re-fetch.
  3. When a timeframe/endpoint is unavailable on the current FMP plan or the daily request budget is exhausted, the UI shows a distinct "requires higher plan" / "rate-limited" state for that timeframe rather than an empty or broken chart.
  4. Switching to a paid FMP key enables previously-gated intraday timeframes with no code change (capability re-probed on key change).

**Plans:** 5 plans
**Wave 1**

- [ ] 02-01-PLAN.md — Tracer: timeframe-switching spine (intraday 1m/5m/15m/1h + daily render end-to-end)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 02-02-PLAN.md — Weekly/monthly candles derived from cached daily bars (no extra FMP fetch)
- [ ] 02-04-PLAN.md — Free-tier capability detection engine + capabilities.get() IPC

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 02-03-PLAN.md — Pan/zoom gap-fetch (only the missing sub-range)
- [ ] 02-05-PLAN.md — Gated timeframe UI (lock/clock + tooltip) + mid-session rate-limit toast

**UI hint**: yes

### Phase 3: Indicator Engine & Overlays

**Goal**: A user can freely overlay any number of configurable moving averages and Bollinger Bands on the price chart through a pluggable indicator system that new indicators can extend without touching chart code.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: IND-01, IND-02, IND-03, IND-07, IND-08
**Success Criteria** (what must be TRUE):

  1. User can add moving-average (SMA or EMA selectable) and Bollinger Band overlays to a chart from an "add indicator" control.
  2. User can add multiple independent instances (e.g., MA 20, MA 50, MA 200 simultaneously) with no artificial count limit, and can toggle each instance's visibility or remove it.
  3. User can live-edit each instance's parameters (period, source, color, stddev multiplier) and see the overlay update immediately with no data re-fetch.
  4. A new indicator can be registered as a self-contained module (compute function + parameter schema + render metadata) without modifying chart-rendering code.

**Plans:** 3 plans
**Wave 1**

- [ ] 03-01-PLAN.md — Tracer: SMA overlay end-to-end (module contract → math+test → ma module → registry → store CRUD+palette → Chart reconcile → +指標 menu → legend)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 03-02-PLAN.md — Schema-driven edit form (D-25) + full legend controls (toggle/edit/delete, overflow scroll)
- [ ] 03-03-PLAN.md — Bollinger Bands module + translucent band fill (proves IND-01: new module, no chart-code change)

**UI hint**: yes

### Phase 4: Pane Indicators, Crosshair & Correct Math

**Goal**: A user can add Volume, RSI, and MACD in synchronized sub-panes with a crosshair that reads every value at a timestamp, and all indicator values match TradingView's conventions.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: IND-04, IND-05, IND-06, IND-09, CHART-04
**Success Criteria** (what must be TRUE):

  1. User can add Volume, RSI (with configurable overbought/oversold levels), and MACD, each rendered in its own sub-pane below the price chart sharing the time axis.
  2. Moving the crosshair shows synchronized price/time plus every visible indicator's value at that timestamp across the price pane and all sub-panes.
  3. Computed indicator values match TradingView reference values for a fixed symbol/date range — RSI Wilder smoothing (SMA-seeded), MACD EMA signal line, Bollinger population standard deviation, correct EMA seeding — verified by a reference-value test suite (correctness gate covering all five v1 indicators).

**Plans**: TBD
**UI hint**: yes

### Phase 5: Layouts, Persistence & Watchlist

**Goal**: A user can arrange multiple independent charts in a grid, manage a persistent watchlist, and save named layouts that (along with the watchlist) auto-restore across sessions — the v1 goal line where the workspace becomes "theirs."
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: LAYOUT-01, LAYOUT-02, LAYOUT-03, LAYOUT-04, WATCH-01, WATCH-02
**Success Criteria** (what must be TRUE):

  1. User can display multiple charts in a grid (1x1 / 2x1 / 2x2), each cell independent in symbol, timeframe, and indicator set.
  2. Chart and layout state is captured in one serializable config model (symbols, timeframes, indicator instances + params, grid arrangement) that the workspace renders from.
  3. User can save a named layout and restore it later; on startup the most recent (or default) layout auto-restores so the workspace looks as it was left.
  4. User can manage a watchlist (add / remove / reorder) that persists across sessions, and clicking a watchlist symbol loads it into the active chart.

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core Pipeline Slice | 0/TBD | Not started | - |
| 2. Timeframes & Free-Tier Resilience | 0/5 | Not started | - |
| 3. Indicator Engine & Overlays | 0/3 | Not started | - |
| 4. Pane Indicators, Crosshair & Correct Math | 0/TBD | Not started | - |
| 5. Layouts, Persistence & Watchlist | 0/TBD | Not started | - |
