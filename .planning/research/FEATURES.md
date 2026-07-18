# Feature Research

**Domain:** Personal desktop stock/crypto charting & technical-analysis tool (TradingView-alternative)
**Researched:** 2026-07-18
**Confidence:** HIGH (charting-app feature landscape and indicator conventions are extremely well-established and cross-verified across TradingView, MetaTrader, Fidelity's charting guide, and general TA literature)

## Feature Landscape

### Table Stakes (Users Expect These)

Without these the tool cannot replace TradingView for daily use — it would feel broken, not just "minimal."

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Symbol search (US stocks + crypto) | Can't chart anything without picking an instrument first | LOW-MEDIUM | Needs a searchable symbol list from FMP (ticker + name fuzzy match); can be a simple local index refreshed periodically rather than live-query-per-keystroke |
| Candlestick rendering (OHLC) | This *is* the product; every TA tool renders candles as the default view | MEDIUM | Needs a canvas/WebGL-based chart renderer (perf matters at 1m resolution over long history); this is the single highest-effort table-stakes item |
| Timeframe switching (1m/5m/15m/1h/D/W/M) | Core TA workflow is "zoom out for context, zoom in for entry" | LOW-MEDIUM | Mostly a data-fetch/aggregation concern once candlestick rendering exists; W/M may need client-side resampling from D bars if FMP doesn't provide them natively |
| Pan & zoom on the time axis | Table stakes for any chart — TradingView, MT4/5, ThinkorSwim, NinjaTrader all support this | LOW-MEDIUM | Usually comes free with a decent charting library; matters more if hand-rolling the renderer |
| Crosshair (price/time readout) | Universal in every charting tool; used constantly to read exact values off the chart | LOW-MEDIUM | Needs to synchronize across price pane + all indicator sub-panes (RSI/MACD/Volume) so one crosshair sweep shows all values at that timestamp — this cross-pane sync is the actual complexity, not the crosshair itself |
| Named indicators: MA/EMA, Bollinger Bands, Volume, RSI, MACD | Explicitly named as required in PROJECT.md; these five are the most-used indicators across all TA platforms | MEDIUM-HIGH | See per-indicator parameter tables below; complexity is in building a general indicator calculation + rendering abstraction, not any single formula |
| Freely toggle/overlay indicators (no count limit) | This is the direct fix for TradingView's #1 free-plan pain point (2-3 indicator cap) | MEDIUM | See UX pattern notes below — needs an indicator-instance list per chart, not just a fixed set of checkboxes |
| Configurable indicator parameters | Traders routinely change periods (e.g. RSI 9 vs 14) per instrument/timeframe; a fixed-parameter indicator is not usable for real analysis | MEDIUM | Requires a parameter schema per indicator type (see tables below) and a settings UI (dialog or inline panel) per indicator instance |
| Watchlist (symbol list management) | Explicitly required; also just baseline for anyone tracking more than one instrument | LOW-MEDIUM | Add/remove/reorder symbols, click-to-load into active chart; single list is enough for v1 (TradingView free caps this at 1 list of 30 — differentiator is removing that cap, not adding multi-list complexity yet) |
| Multiple charts / layouts on screen at once | Explicitly required; direct fix for TradingView free's "1 chart per tab" limit | MEDIUM-HIGH | Grid layout (e.g. 1x1, 2x1, 2x2) with independent symbol/timeframe/indicators per cell; complexity is state management, not rendering (each cell reuses the single-chart component) |
| Save & restore layout/config | Explicitly required (v1 goal line); this is what makes the tool "yours" instead of resetting every launch | MEDIUM | Requires the whole chart state (symbols, timeframes, indicator instances + params, pane sizes, grid arrangement) to be a serializable model — see Dependencies section |
| Dark theme | Stated requirement; also the de facto standard look for every trading terminal (TradingView, ThinkorSwim, Bloomberg terminal, NinjaTrader all default dark) | LOW | Straightforward theming if colors are chosen up front; low technical risk, mentioned only because it's explicitly required, not because it's hard |
| Local persistent price-data cache | Explicitly required; primary purpose is avoiding FMP re-fetches within the free-tier rate limit | MEDIUM | Needs a local store (SQLite/IndexedDB-equivalent) keyed by symbol+timeframe+range, with logic to fetch only the missing gap rather than the whole range each time |

### Differentiators (Competitive Advantage)

These aren't "extra features" in the usual sense — for this project the differentiators ARE the table-stakes items above, delivered *without TradingView's free-tier restrictions*. Listed here are the specific restriction-removals and personal-tool advantages that constitute the actual value proposition.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Unlimited indicators per chart | TradingView free caps at 2-3; this is the most-cited complaint among free-tier users | LOW (once indicator system exists) | Pure removal of an artificial cap — no extra engineering once the indicator-instance architecture (table stakes item above) exists |
| Unlimited charts per layout / unlimited saved layouts | TradingView free allows 1 chart per tab and only 1 saved layout | LOW (once layout persistence exists) | Same pattern: the hard part is building layout persistence at all; once built, "how many" is just not artificially bounding it |
| No ads, no forced login, no session nags | Direct pain point named in PROJECT.md | TRIVIAL | Simply the natural state of a self-hosted personal app; zero engineering cost |
| No historical-bar-count ceiling | TradingView free caps ~5,000 bars/chart, which starves 1-minute charts to ~8 trading days of lookback | LOW-MEDIUM | Bounded only by what FMP's API and local cache can hold; no artificial UI cap needed |
| Extensible indicator plugin architecture | Explicitly requested ("indicator system abstracted so new indicators can be added later") | MEDIUM-HIGH | Real architectural investment: indicator = (id, param schema, calc fn, render spec: overlay-on-price-pane vs own-pane). Pays off directly when adding indicator #6+ later |
| Extensible data-source abstraction (FMP-first, others later) | Explicitly requested; also mitigates FMP-specific outages/coverage gaps (e.g. JP stocks) | MEDIUM | Provider interface (symbol search, historical bars, resolution list) sits behind the cache layer; FMP is the only implementation in v1 |
| Instant reload from local cache (perceived "offline-first" speed) | Because data is cached, reopening a chart/layout is instant vs. a live re-fetch — a paid-tier-like feel with zero subscription | LOW-MEDIUM | Falls out of the local cache table-stakes item; worth calling out because it's a felt UX win, not just an infra detail |
| Full historical range control per timeframe | No paywall gate on how far back you can scroll on 1m/5m charts (bounded only by FMP coverage + cache) | LOW | Same underlying mechanism as the bar-count item above |

### Anti-Features (Deliberately Out of Scope for v1)

Common in mainstream TA tools, but deliberately skipped here — either because PROJECT.md already excludes them, or because they don't serve a single personal user and would blow up scope.

| Feature | Why Requested (in general market) | Why Problematic Here | Alternative |
|---------|-----------------------------------|-----------------------|-------------|
| Drawing tools (trendlines, Fibonacci, shapes, annotations) | Universal in TradingView/MT4/ThinkorSwim; used heavily for manual TA | Significant UI/interaction engineering (hit-testing, persistence per-chart, undo) for a feature not in the v1 goal line | Explicitly deferred (per PROJECT.md); revisit post-v1 once core charting/layout is solid |
| Price alerts / notifications | Core TradingView feature, drives daily engagement | Requires a background process/scheduler and (for true usefulness) push/desktop notifications — real infra for a "check when I look" personal tool | Explicitly deferred (per PROJECT.md); manual checking is acceptable given "delay OK" usage pattern |
| Real-time (sub-minute) streaming quotes via WebSocket | Table stakes for day-trading terminals | Explicitly not needed — usage pattern tolerates delay even on 1m/1h bars; WebSocket infra (reconnect/backoff, live bar patching) is pure complexity with no validated user need | Manual refresh / periodic poll against cached data, as already decided in PROJECT.md |
| Multi-user auth, cloud sync, shared workspaces | TradingView needs this because it's a hosted multi-tenant product | This is a single-machine personal tool (or shared only via each person running their own instance with their own FMP key); building auth is solving a problem that doesn't exist here | Local-only storage; if a "few friends" use it, each runs their own local install/cache (already the stated distribution model) |
| Broker integration / order execution / paper trading | ThinkorSwim, NinjaTrader, TradingView (via broker plugins) all support this | Massive scope and regulatory/complexity surface (order routing, account state, execution risk) totally outside "look at charts" goal | None needed — this tool is observation-only by design |
| Custom scripting language (Pine-Script-equivalent) for user-authored indicators | TradingView's biggest differentiator for power users and the community-script ecosystem | Building a DSL + sandboxed execution engine is a multi-month project on its own; the stated need is "add new *built-in* indicators over time," not end-user scripting | Indicator plugin architecture (differentiator above) lets *the developer* add new indicators in code; no need for a user-facing scripting layer in v1 |
| Screener / market-wide scanner | Common in TradingView, ThinkorSwim, Finviz | Needs bulk cross-symbol data pulls and a very different UI (table/filter, not chart); would strain FMP free-tier rate limits fast | Not needed for "look at charts I already picked"; watchlist covers the personal symbol-tracking need |
| News feed / fundamentals panel integration | Common companion panel in TradingView and broker platforms | Separate data domain (news API, sentiment), separate UI real estate, no stated need | Skip; user can check news elsewhere |
| Backtesting / strategy tester | Present in TradingView (Pine strategies), ThinkorSwim, NinjaTrader | Needs an execution/simulation engine and a strategy-definition model — an entirely different product surface than charting | Skip entirely for this tool's scope |
| Social/community features (published ideas, chat, script/indicator sharing) | Big part of TradingView's engagement loop | Zero relevance for a personal/small-group tool with no public presence | Skip; not aligned with "personal use" core value |
| Mobile app / responsive mobile layout | TradingView, ThinkorSwim, etc. all ship mobile apps | Explicitly a Windows desktop app per PROJECT.md constraints | Skip; desktop-only is the stated platform |
| AI-driven auto chart-pattern recognition / signal suggestions | Newer TradingView Premium+ feature, marketed heavily | Complex ML feature with unclear payoff for a single disciplined user who already knows what they're looking for | Skip; not a stated need and orthogonal to the "unrestricted manual charting" core value |
| Synchronized crosshair *across independent charts* in a multi-chart layout | Nice power-user feature in some platforms (link charts by symbol/crosshair) | Adds real complexity (cross-component event bus, symbol-group linking) beyond the stated v1 goal of "multiple charts/layouts" | Keep each chart's crosshair independent for v1; consider as a v1.x enhancement only if it turns out to be missed in daily use |

## Feature Dependencies

```
Candlestick rendering (chart engine)
    └──requires──> Local persistent cache (needs bars to render)
                       └──requires──> Data-source abstraction (FMP client + cache sit behind one interface)

Timeframe switching
    └──requires──> Candlestick rendering
    └──requires──> Local persistent cache (per symbol+timeframe storage key)

Crosshair (cross-pane sync)
    └──requires──> Candlestick rendering
    └──requires──> Indicator panes existing (RSI/MACD/Volume render in separate panes sharing the x-axis)

Indicator toggle/overlay system
    └──requires──> Indicator plugin architecture (calc fn + param schema + render spec: overlay vs own-pane)
    └──requires──> Candlestick rendering (indicators are computed from OHLC(V) series)

Configurable indicator parameters
    └──requires──> Indicator toggle/overlay system (each instance needs its own param values)

Multiple charts / layouts
    └──requires──> Candlestick rendering componentized as a reusable single-chart unit
    └──requires──> Indicator toggle/overlay system (each chart cell has its own indicator set)

Layout save/restore (v1 goal line)
    └──requires──> Multiple charts / layouts (grid arrangement must exist to persist it)
    └──requires──> Configurable indicator parameters (persisted state must capture indicator instances + params, not just symbol/timeframe)
    └──requires──> A serializable chart-config model (symbol, timeframe, indicator instances+params, pane sizes, grid position) — this model is the true shared dependency underneath both multi-chart and persistence

Watchlist (v1 goal line)
    └──requires──> Symbol search (same underlying symbol index/lookup)
    └──enhances──> Multiple charts / layouts (click a watchlist symbol to load it into the active chart cell)

Watchlist persistence
    └──requires──> Layout save/restore's serialization mechanism (same "save app state to disk" facility, extended to cover the watchlist too)

FMP-free-tier resilience (rate-limit-safe design)
    └──requires──> Local persistent cache (cache-first fetch strategy is what prevents free-tier limits from breaking the app)
    └──requires──> Data-source abstraction (lets provider-specific rate-limit/backoff logic live in one place)

Data-source abstraction
    └──enables──> Future non-FMP providers (e.g. for JP stocks later) without touching chart/indicator code

Indicator plugin architecture
    └──enables──> Future indicators beyond the initial five without touching chart rendering code
```

### Dependency Notes

- **Layout persistence depends on a serializable chart-config model, which depends on configurable indicator parameters existing first.** You cannot design "save/restore a layout" as an afterthought — the config model (symbol, timeframe, list of indicator instances with their params, pane sizes, grid arrangement) needs to be the *single source of truth* the chart renders from, so that saving it is just serializing that object. Build the config model before building persistence, not after.
- **Multiple charts and layout persistence share the same underlying need:** a chart must be a self-contained, reusable unit (its own config object) before either "show N of them side by side" or "save this arrangement" makes sense. Treat "componentize the single chart" as a prerequisite phase, not a byproduct of building the grid UI.
- **Crosshair complexity comes from indicator panes, not from the crosshair itself.** A crosshair on a plain candlestick chart is nearly trivial; the real work is keeping it synchronized across the price pane and any stacked RSI/MACD/Volume sub-panes so one hover shows consistent values everywhere. Sequence indicator-pane rendering before polishing crosshair behavior.
- **Watchlist and symbol search reuse the same lookup mechanism** — build the symbol index/search once and use it for both "search to load a chart" and "add to watchlist," rather than building two separate lookups.
- **The indicator plugin architecture and the data-source abstraction are the two "pay it forward" investments explicitly called out in PROJECT.md.** Both should be designed early (even though v1 only ships 5 indicators and 1 provider) because retrofitting an abstraction after five indicators are hard-coded is much more expensive than designing the interface first and implementing FMP/MA/BB/Volume/RSI/MACD against it from day one.
- **Local cache and rate-limit resilience are the same concern viewed from two angles.** The cache isn't just "load faster" — given the constraint that free-tier FMP limits must not break the app, cache-first fetching (only request the gap between what's cached and what's needed) is a functional requirement, not an optimization. Build it as core plumbing, not a later perf pass.

## Indicator Parameter Reference

Standard parameters and default values users expect from any credible charting tool (cross-verified against TradingView, MetaTrader, and Fidelity's charting reference guide — these defaults are near-universal across platforms):

### Moving Average (SMA) / EMA
| Parameter | Default | Notes |
|-----------|---------|-------|
| Length (period) | 9 (TradingView's generic "Moving Average" built-in default) — but in practice traders commonly add multiple instances at 20 / 50 / 200 for short/medium/long-term trend context | Users expect to add *several* MA instances at once (e.g. 20 & 50 & 200 simultaneously), each independently configurable — not a single MA slot |
| Source | Close | Other options (Open/High/Low/HL2/HLC3/OHLC4) expected but Close is the default 95%+ of the time |
| MA type | Simple (SMA) by default; EMA/WMA/RMA as selectable alternatives | Treat "MA type" as a dropdown on the same indicator rather than separate SMA/EMA indicators — this is how TradingView, MT4/5, and most tools model it |
| Offset | 0 | Rarely changed; include for completeness but low priority to expose prominently |
| Line color/width | Any distinct color, 1-2px | Cosmetic but expected to be user-changeable per instance so multiple MAs are visually distinguishable |

### Bollinger Bands
| Parameter | Default | Notes |
|-----------|---------|-------|
| Length | 20 | Basis is a 20-period SMA of Close |
| StdDev multiplier | 2.0 | Upper = basis + (StdDev × 2), Lower = basis − (StdDev × 2) |
| Basis MA type | SMA | Some platforms allow EMA basis as an option; SMA is the default everywhere |
| Source | Close | Same convention as MA |
| Offset | 0 | Rarely changed |
| Band fill/shading | Semi-transparent fill between bands (common visual convention) | Not a "parameter" per se but an expected rendering detail |

### Volume
| Parameter | Default | Notes |
|-----------|---------|-------|
| Display | Histogram bars below/behind price pane, colored by candle direction (green/up vs red/down, or platform's up/down color pair) | No numeric parameters required for the base indicator |
| Volume MA overlay (optional) | 20-period SMA of volume, commonly offered as an add-on toggle | Optional enhancement, not required for v1 parity, but very commonly present |
| Pane placement | Own sub-pane under the price chart (not overlaid on price) OR as a translucent overlay at the chart's bottom — both conventions exist; TradingView defaults to a separate compact pane | Decide one convention; separate pane is the more common modern default |

### RSI (Relative Strength Index)
| Parameter | Default | Notes |
|-----------|---------|-------|
| Length | 14 | The universal classic default; shorter (5-9) used by scalpers, longer (20+) for smoother swing signals — must be user-configurable |
| Source | Close | Standard |
| Smoothing | Wilder's RMA (the original RSI smoothing method) | Some platforms expose an additional post-smoothing MA (e.g. RSI + signal line via SMA/EMA) as an optional overlay — not required for v1 baseline |
| Overbought level | 70 | Rendered as a horizontal reference line |
| Oversold level | 30 | Rendered as a horizontal reference line |
| Pane placement | Own sub-pane (0-100 scale), below the price chart | Standard convention across all platforms |

### MACD (Moving Average Convergence Divergence)
| Parameter | Default | Notes |
|-----------|---------|-------|
| Fast length | 12 | EMA period for the fast line |
| Slow length | 26 | EMA period for the slow line |
| Signal length | 9 | EMA period applied to the MACD line itself, producing the signal line |
| Source | Close | Standard |
| MA type (fast/slow) | EMA | Some platforms allow SMA as an alternative; EMA is the near-universal default |
| MA type (signal) | EMA (sometimes SMA) | EMA is the more common default; SMA is a common alternative |
| Histogram | MACD line − Signal line, rendered as a bar histogram | Standard third visual element alongside the two lines |
| Pane placement | Own sub-pane, separate from RSI and from price | Never overlaid on the price pane |

**General rule for all five:** ship with the defaults above pre-filled, but every numeric parameter must be user-editable per indicator *instance* — since the whole point of this tool is removing the "fixed/limited configuration" frustration of the free tier, hard-coding any of these values would defeat the purpose.

## UX Pattern Notes

### "Freely toggle/overlay indicators" — how this typically works

1. **Add flow:** an "Add indicator" action (button/menu on the chart toolbar) opens a searchable list/picker of available indicator types (MA, EMA, Bollinger Bands, Volume, RSI, MACD, ...). Selecting one adds a new *instance* with default parameters — critically, this is additive: adding "MA" again creates a second independent MA instance (e.g. a 20 and a 50 simultaneously), not a single slot that gets overwritten.
2. **Active indicator list:** each chart keeps a visible list of currently-active indicator instances (often a small panel or icon-row overlaid on the chart, or a collapsible sidebar). Each entry shows the indicator name + key params (e.g. "MA 20") and offers per-instance controls: edit (opens a settings dialog for parameters/colors), toggle visibility (eye icon, hide without removing), and remove.
3. **Two rendering destinations:** indicators fall into two categories that determine where they render —
   - **Overlay indicators** (MA/EMA, Bollinger Bands) draw directly on top of the price candlestick pane, sharing its price axis.
   - **Own-pane indicators** (Volume, RSI, MACD) render in separate horizontal sub-panes stacked below the price pane, each with its own y-axis scale, but all sharing the same x-axis (time) so panning/zooming/crosshair stay aligned across all panes.
   This split must be part of the indicator's definition/metadata (not something the user configures) since it's determined by the indicator's value range, not user preference.
4. **Per-instance settings dialog:** clicking "edit" on an indicator instance opens a small form exposing that indicator's parameter schema (period, source, colors, thresholds like RSI's 70/30 lines) — changes apply live to that chart without affecting other instances or other charts.
5. **No artificial ceiling:** unlike TradingView free (2-3 indicator cap), there is no limit on how many instances a chart can hold — this is the direct differentiator, and technically just means "don't add an arbitrary cap," since the architecture (a list of indicator instances per chart) naturally supports any count.

### "Multiple charts in a layout" — how this typically works

1. **Grid layout picker:** a small set of preset grid arrangements (1x1 single chart, 1x2 / 2x1 split, 2x2 quad, etc.) selectable from a toolbar — this is the standard pattern in TradingView Premium+, ThinkorSwim, and NinjaTrader.
2. **Independent chart cells:** each cell in the grid is a fully independent chart instance — its own symbol, timeframe, and set of indicator instances (per the toggle system above). Changing the symbol in one cell does not affect others (unless explicit symbol-linking is added later, which is out of scope per the Anti-Features table).
3. **Cell resize:** dividers between cells are typically draggable to resize panes (common in ThinkorSwim/NinjaTrader-style layouts); a fixed grid without resize is an acceptable v1 simplification if resize proves costly.
4. **Layout as a named, saved entity:** the whole grid arrangement (cell count/positions, each cell's symbol/timeframe/indicators) is saved as a named layout (e.g. "Daily Watch," "Crypto Scalping") and can be recalled later — this is exactly the v1 goal-line feature, and it depends on the chart-config-model dependency noted above.
5. **Startup restore:** on app launch, the most recently used (or explicitly pinned "default") layout loads automatically, so the user's workspace is exactly as they left it — this is the core "make it feel like *mine*" payoff of the persistence work.

## MVP Definition

### Launch With (v1)

This matches PROJECT.md's Active requirements list directly — all of it is table stakes for a usable personal charting tool, and per the v1 goal line ("watchlist + layout persistence working"), nothing here can be deferred without leaving the tool feeling broken:

- [ ] Symbol search (US stocks + crypto via FMP) — nothing else works without picking an instrument
- [ ] Candlestick chart rendering across 1m/5m/15m/1h/D/W/M — this is the core product
- [ ] Freely toggle-able indicator overlays: MA/EMA, Bollinger Bands, Volume, RSI, MACD — the explicit reason this tool exists over TradingView free
- [ ] Configurable indicator parameters (period etc.) per instance — a fixed-parameter indicator isn't real TA
- [ ] Indicator system built as an abstraction from day one — explicitly requested, and much cheaper to build now than retrofit
- [ ] Crosshair with price/time readout, synced across price + indicator panes — baseline chart-reading UX
- [ ] Multiple charts / layouts on screen simultaneously — direct fix for TradingView free's biggest complaint
- [ ] Watchlist management — v1 goal line
- [ ] Save & restore chart configuration and layout — v1 goal line
- [ ] Local persistent price-data cache — required to avoid burning FMP free-tier limits, and to make reloads instant
- [ ] Data-source abstraction (FMP as the only implementation) — explicitly requested, cheap to build alongside FMP integration
- [ ] Dark theme — explicitly required, low cost

### Add After Validation (v1.x)

Trigger: once the v1 goal line (watchlist + layout persistence) is working and the app is in daily personal use.

- [ ] Volume moving-average overlay (e.g. 20-period volume SMA) — natural small addition once Volume + MA both exist
- [ ] Multiple independent watchlists (vs. a single list) — add if one list starts feeling cramped in daily use
- [ ] Indicator instance presets/templates ("my standard setup") to quickly apply a saved indicator combo to a new chart — add once you notice yourself manually re-adding the same 3-4 indicators repeatedly
- [ ] Draggable/resizable pane splits within a multi-chart layout — add if the fixed grid feels too rigid in practice
- [ ] A second data provider behind the abstraction (e.g. for JP stocks or crypto-specific data) — add when FMP coverage gaps actually get in the way

### Future Consideration (v2+)

Explicitly deferred per PROJECT.md's Out of Scope, or identified here as reasonable later additions once the core tool has proven itself:

- [ ] Drawing tools (trendlines, Fibonacci, shapes) — real manual-TA feature but meaningful UI investment; defer until core charting/layout is solid
- [ ] Price alerts/notifications — needs background scheduling + notification delivery; defer until "check when I look" stops being sufficient
- [ ] Cross-chart crosshair/symbol linking within a layout — nice power-user touch, not core to the v1 value prop
- [ ] Japanese stock coverage via a second provider — deferred due to FMP's weak JP coverage; revisit once data-source abstraction is proven with FMP alone
- [ ] Custom/user-authored indicators (scripting) — the plugin architecture already lets the *developer* add indicators in code; a full DSL is a separate, much larger project with no stated need

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|----------------------|----------|
| Candlestick rendering + timeframe switching | HIGH | HIGH | P1 |
| Local persistent cache + data-source abstraction | HIGH | MEDIUM | P1 |
| Indicator plugin architecture (5 built-ins: MA/EMA, BB, Volume, RSI, MACD) | HIGH | HIGH | P1 |
| Configurable per-instance indicator parameters | HIGH | MEDIUM | P1 |
| Crosshair synced across panes | HIGH | LOW-MEDIUM | P1 |
| Multiple charts / grid layouts | HIGH | MEDIUM-HIGH | P1 |
| Layout save/restore | HIGH | MEDIUM | P1 |
| Watchlist | HIGH | LOW-MEDIUM | P1 |
| Dark theme | MEDIUM | LOW | P1 |
| Volume MA overlay | LOW-MEDIUM | LOW | P2 |
| Multiple watchlists | LOW-MEDIUM | LOW | P2 |
| Indicator presets/templates | MEDIUM | LOW-MEDIUM | P2 |
| Resizable pane splits | LOW-MEDIUM | MEDIUM | P2 |
| Second data provider | MEDIUM (situational) | MEDIUM | P2/P3 |
| Drawing tools | MEDIUM | HIGH | P3 |
| Price alerts | MEDIUM | MEDIUM-HIGH | P3 |
| Cross-chart linking | LOW | MEDIUM | P3 |
| Custom scripting for indicators | LOW (no stated need) | VERY HIGH | P3 (likely never) |

**Priority key:**
- P1: Must have for launch (the v1 goal line requires all of these to be true simultaneously)
- P2: Should have, add when possible once v1 is in daily use
- P3: Nice to have, future consideration only

## Competitor Feature Analysis

| Feature | TradingView (free tier) | TradingView (paid tiers) | Desktop TA tools (ThinkorSwim / NinjaTrader) | Our Approach |
|---------|--------------------------|----------------------------|-----------------------------------------------|--------------|
| Indicators per chart | Capped at 2-3 | 5 (Essential) up to 50 (Ultimate) | Effectively unlimited | Unlimited — no cap, by design |
| Charts per tab/layout | 1 | 2 (Essential) up to 16 (Ultimate) | Effectively unlimited, multi-monitor common | Unlimited grid, bounded only by screen space |
| Saved layouts | 1 | More on paid tiers | Effectively unlimited | Unlimited named saved layouts |
| Watchlists | 1 list, 30 symbols | Up to 1,000 symbols/list on paid tiers | Effectively unlimited | No artificial cap for v1; consider multi-list only if needed later |
| Historical bars per chart | ~5,000 | 10,000-40,000 depending on tier | Provider-dependent, often deep | Bounded only by FMP + local cache, no UI-imposed ceiling |
| Ads / login required | Yes | No (paid) | No | None — personal self-hosted app |
| Custom scripting (Pine Script equivalent) | Community scripts usable, authoring limited on free | Full Pine Script authoring | ThinkScript / NinjaScript | Not built for v1; developer-extensible indicator plugin system instead |
| Real-time streaming quotes | Delayed/limited on free | Real-time with data add-ons | Real-time (brokerage-fed) | Not needed — delayed/manual refresh accepted by design |
| Drawing tools | Full set, free | Full set | Full set | Deferred to post-v1 |
| Price alerts | 3 price alerts, no indicator alerts | Up to 1,000 alerts | Extensive alerting | Deferred to post-v1 |

## Sources

- [TradingView Free: Indicator Limits & How to Max Usage in 2026 — Headway](https://hw.online/faq/tradingview-free-indicator-limits-and-how-to-maximize-usage/) — HIGH confidence for the specific free-tier cap figures (cross-checked against multiple sources below; some numeric discrepancy noted between 2 vs 3 indicators, both cited)
- [TradingView Plan Comparison 2026 — ChartWiseHub](https://chartwisehub.com/tradingview-plan-comparison/)
- [TradingView Plans and Pricing 2026 — Friend of the Trend](https://friendofthetrend.com/tradingview/plan-comparison/)
- [TradingView Subscriptions: Pricing and Features — TradingView official](https://www.tradingview.com/pricing/) — authoritative for tier feature counts
- [TradingView Review 2026 — StockBrokers.com](https://www.stockbrokers.com/review/tools/tradingview)
- [Charting Library User Guide / Indicators Reference — Fidelity](https://www.fidelity.com/webcontent/ap130058-research-experience-content/23.01/chartGuide/indicators.pdf) — authoritative source for standard indicator parameter conventions
- [MACD Indicator Guide: Day Trading Settings & Strategies 2026 — TradingSim](https://www.tradingsim.com/blog/macd) — confirms 12/26/9 as universal MACD default
- [RSI, MACD & Bollinger Bands guide — DayTradingToolkit](https://daytradingtoolkit.com/beginners-guide/rsi-macd-bollinger-bands-guide) — confirms RSI 14 / BB 20,2 / MACD 12,26,9 as cross-platform defaults
- General domain knowledge of TradingView, ThinkorSwim, NinjaTrader, and MetaTrader 4/5 feature sets and indicator UX conventions (widely and consistently documented across trading-education sources; treated as HIGH confidence due to convergence across independent platforms and this agent's training knowledge)
- `E:\work\trading-view\.planning\PROJECT.md` — project requirements, constraints, and explicit out-of-scope decisions used to anchor categorization

---
*Feature research for: personal desktop stock/crypto charting & TA application (TradingView alternative)*
*Researched: 2026-07-18*
