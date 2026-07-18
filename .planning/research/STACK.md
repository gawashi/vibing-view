# Stack Research

**Domain:** Personal TradingView-alternative desktop charting app (Windows, TypeScript + React, FMP-backed, few-user distribution)
**Researched:** 2026-07-18
**Confidence:** HIGH (desktop shell, charting library, persistence, state management) / MEDIUM (FMP free-tier exact endpoint gating — official pricing/docs pages returned HTTP 403 to automated fetch; findings triangulated from cached docs, community posts, and FMP's own how-to articles)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|------------------|
| **Electron** | 43.x | Desktop shell (window, native menus, filesystem, packaging) | For a TS-only developer building a tool for "a few close users" on Windows, Electron's all-JS/TS stack beats Tauri's Rust-glue tax. See `<desktop-shell-decision>` below — this is the single highest-leverage decision in the stack and deserves the full rationale, not just a table row. |
| **React** | 19.2.x | UI rendering | Already fixed by user constraint. React 19's `useSyncExternalStore` (stable since 18) is exactly the primitive chart-state libraries (Zustand, TanStack Query) build on — no extra glue needed for tearing-free external-store subscriptions across many chart widgets. |
| **TypeScript** | 7.0.x (the new native/"Corsa" compiler line) | Language | TS 7 ships this year as a from-scratch native port of the compiler (10x+ faster builds/type-check), fully source-compatible with 5.x-authored code. Safe to adopt for a greenfield project; if the native tsc/tsserver toolchain proves too new for your editor setup, TS 6.0.3 (still maintained) is a zero-risk fallback — same language, JS-hosted compiler. |
| **lightweight-charts** (TradingView OSS) | 5.2.0 | Charting engine — candlesticks, panes, crosshair | See `<charting-library-decision>` below. Purpose-built by TradingView for exactly this use case (financial OHLCV + overlays), canvas-rendered, ~45KB, native multi-pane API (`addSeries(..., paneIndex)` / `series.moveToPane()`), native crosshair with per-series price/time sync out of the box. |
| **Vite** | 7.x (pin here, NOT 8.x — see Version Compatibility) | Frontend build tool | Standard modern React build tool; both `electron-vite` and Tauri's official React template are built on Vite, so this is the natural choice regardless of shell. |
| **better-sqlite3** | 12.x | Local persistent price-data cache | Synchronous, native-C++-bound, fastest SQLite driver for Node; ideal for a single-process desktop app where "永続キャッシュ" (permanent local cache) is the whole point of the persistence layer. Runs in Electron's main process. |
| **drizzle-orm** | 0.45.x | Typed schema + queries over the SQLite cache | Thin, zero-runtime-overhead TS ORM with first-class `better-sqlite3` driver support; gives you migrations and typed OHLCV row access without an abstraction so heavy it fights SQLite's simplicity. |
| **Zustand** | 5.0.x | Client UI state (active symbol, active layout, toggled indicators, panel positions) | Minimal (~1.1KB), no Provider tree needed, module-level store works well for a multi-window/multi-chart desktop app where state needs to be read from deeply nested widgets without prop drilling. |
| **TanStack Query** | 5.101.x | Server-state layer (FMP fetches) sitting in front of the SQLite cache | Gives you request de-duplication, background refetch-on-demand ("manual refresh" fits its `refetchOnDemand`/manual `invalidateQueries` model perfectly), and stale-time control — this is the layer that enforces "don't hit FMP if we already have the bars" when paired with a custom `queryFn` that reads-through the SQLite cache first. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **electron-vite** | 5.0.0 | Electron + Vite build integration (main/preload/renderer) | Use if Electron is chosen (recommended). Handles HMR for the renderer and rebuilds the main/preload processes on change — the standard modern replacement for hand-rolled `electron-builder` + webpack configs. |
| **electron-builder** | 26.x | Packaging/installer generation (NSIS installer for Windows) | Produces the `.exe`/NSIS installer you hand to your "few close users." Also runs the native-module rebuild step (`better-sqlite3` needs to be compiled against Electron's ABI, not Node's — electron-builder's `install-app-deps` / postinstall hook handles this automatically). |
| **@electron/rebuild** | latest | Native module ABI rebuild for `better-sqlite3` | Add as a `postinstall` script if the electron-builder auto-rebuild step is skipped in your dev workflow (e.g., you `npm install` outside of a build). One-time setup cost, not an ongoing pain point. |
| **electron-store** or a small JSON file under `app.getPath('userData')` | latest | Saved layouts, watchlists, window state (small, non-tabular config data) | Don't put layout/watchlist JSON in SQLite — it's app config, not price data. Keep the two persistence concerns separate: SQLite = OHLCV cache (large, tabular, queried by range); flat JSON = user preferences/layouts (small, read-whole-file-on-load). |
| **Custom indicator engine (hand-written TS)** | n/a | SMA, EMA, Bollinger Bands, RSI, MACD, Volume computation | See `<indicator-computation-decision>` below — recommend hand-rolled, not a library dependency. |
| **trading-signals** | 7.4.3 | Optional reference implementation / fallback for indicator math | Actively maintained (last publish Jan 2026), TypeScript-native, streaming/incremental-update friendly (important later if you ever add periodic auto-refresh — an indicator that can accept one new bar without recomputing the whole series). Use to cross-check your hand-written formulas during development, or adopt directly if you'd rather not hand-roll RSI/MACD. |
| **zod** | latest 3.x/4.x | Runtime validation of FMP API responses before they hit the SQLite cache | FMP's JSON shapes vary by endpoint/tier and occasionally return error-shaped payloads (e.g., rate-limit messages) with HTTP 200. Validate at the data-source-adapter boundary so a malformed response never gets written into your permanent cache. |
| **date-fns-tz** or **Luxon** | latest | Timezone-correct handling of intraday bar timestamps | FMP intraday timestamps are exchange-local or UTC depending on endpoint; you need reliable conversion for candlestick x-axis alignment across 1m/5m/15m/1h vs daily/weekly/monthly bars. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **electron-vite** dev server | Renderer HMR + main/preload watch rebuild | Configure `vite: '^7'` explicitly; do not let a lockfile drift to Vite 8 (see Version Compatibility). |
| **Vitest** | Unit tests for indicator math and the data-source adapter layer | Indicator correctness (RSI/MACD/Bollinger formulas) is exactly the kind of pure-function logic that benefits from a solid unit-test suite, especially once the indicator system is pluggable and third indicators get added later. |
| **Playwright (Electron mode)** | End-to-end smoke test of chart rendering, crosshair, layout save/restore | Playwright has first-class Electron app testing support; useful for catching regressions in chart-render/crosshair/layout-restore flows without manual re-testing on every change. |

## Installation

```bash
# Core shell + build tooling
npm install electron@43 --save-dev
npm install electron-vite@5 electron-builder@26 --save-dev
npm install vite@7 --save-dev

# React
npm install react@19 react-dom@19
npm install -D typescript@7 @types/react@19 @types/react-dom@19

# Charting
npm install lightweight-charts@5.2.0

# Persistence
npm install better-sqlite3@12 drizzle-orm@0.45
npm install -D drizzle-kit @types/better-sqlite3
npm install -D @electron/rebuild

# State + data-fetching
npm install zustand@5 @tanstack/react-query@5

# Data validation / time handling
npm install zod luxon

# Optional: indicator cross-check / streaming indicators
npm install trading-signals

# Testing
npm install -D vitest @playwright/test
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| Electron | Tauri v2 | If you're willing to invest in learning minimal Rust (even `tauri-plugin-sql`'s "JS-only" API still requires a one-time Cargo/`src-tauri` setup and capability config), and you care about the ~5-10MB installer / ~30-50MB RAM footprint vs Electron's ~100-150MB / ~150-300MB. For "a few close users" on modern Windows machines, that footprint difference is very unlikely to matter in practice — but if this app later grows beyond personal/close-friends use, or you want iOS/Android reach from the same codebase, revisit Tauri then. |
| lightweight-charts | klinecharts (10.0.0) | If you want indicators and multi-pane layouts working with far less custom plugin code — KLineChart ships dozens of built-in indicators and a purpose-built multi-pane trading-terminal layout system out of the box. Trade-off: smaller community/ecosystem than TradingView's own library, and since this project explicitly wants a *pluggable custom indicator system*, klinecharts' built-in indicator set is less relevant than lightweight-charts' cleaner low-level series/pane primitives, which is exactly what a custom plugin architecture wants to build on top of. |
| lightweight-charts | Apache ECharts | If the TradingView attribution requirement (see What NOT to Use) becomes a real blocker, or you want one charting library across the whole app (financial + any future non-financial charts). Trade-off: ECharts is general-purpose — you'd hand-build candlestick rendering, pane-linking, and crosshair sync yourself using its `grid`/`axisPointer` primitives, meaningfully more upfront work than a library purpose-built for OHLCV. |
| lightweight-charts | Highcharts Stock | Only if you have (or are willing to pay for) a Highcharts commercial license and want an enterprise-polish, batteries-included stock charting UI. Unnecessary cost/weight for a personal project — explicitly listed here so it's not silently reconsidered later without this context. |
| better-sqlite3 | @libsql/client (0.17.4) | If you anticipate wanting to sync the local cache to a hosted Turso database later (e.g., to share a cache across your own multiple machines). Same SQLite file format, async API instead of sync. Not needed for "a few close users each with their own FMP key and their own local cache." |
| Zustand | Jotai (2.20.2) | If, once built, you find the inter-widget derived state (e.g., "toggle an indicator on one chart should recompute a shared watchlist column") getting tangled in a single Zustand store. Jotai's atomic model handles many independent-but-linked pieces of state more cleanly. Reasonable to start with Zustand (simpler mental model, less ceremony) and introduce Jotai selectively later if a specific screen needs it — not an all-or-nothing choice. |
| Zustand | Redux Toolkit (RTK) | Only if strict action-audit-trail / time-travel debugging becomes a real requirement (e.g., if this app is ever used to review "why did this alert fire" style logic). Overkill for the current scope — extra ceremony with no corresponding benefit for a personal charting tool. |
| Custom indicator engine | technicalindicators (npm) | Avoid — see What NOT to Use. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| **react-financial-charts** | Last published 2023-05, effectively unmaintained; built on d3 + SVG (not canvas), meaningfully slower than canvas-based alternatives at the bar counts a "years of 1m data" cache will produce. Was a reasonable pick in 2019-2021; is now a dead end. | lightweight-charts (recommended) or klinecharts |
| **technicalindicators (npm package)** | Last published 2023-07, no updates since — for a project explicitly designed around a *pluggable indicator system* that should be easy to extend, depending on a stale third-party package for the core computation is the wrong foundation. The formulas themselves (SMA/EMA/BB/RSI/MACD) are well-documented, stable, and small enough (~20-40 lines each) to own directly, which also makes them trivially testable and lets each "indicator plugin" be a self-contained, fully-typed TS module with no external dependency risk. | Hand-written TS indicator modules (see `<indicator-computation-decision>`), cross-checked against `trading-signals` (actively maintained, Jan 2026) during development |
| **Vite 8.x with electron-vite** | electron-vite@5.0.0's declared peer range is `vite: '^5.0.0 \|\| ^6.0.0 \|\| ^7.0.0'` — it does not yet declare support for Vite 8 (released ahead of electron-vite's peer-dep update). Installing latest-Vite blind will pull 8.x and risk silent incompatibility or a hard peer-dep failure depending on your package manager's strictness. | Pin `vite@^7` explicitly in `package.json` until electron-vite publishes a release declaring Vite 8 support |
| **Building a custom WebSocket streaming layer to FMP** | Out of scope per PROJECT.md (manual/delayed refresh is explicitly acceptable), and FMP's free/lower tiers don't reliably offer true real-time streaming anyway — building this is wasted complexity against a requirement that doesn't exist. | TanStack Query's manual `refetch`/`invalidateQueries` triggered by a user-facing "Refresh" action, backed by the SQLite read-through cache |
| **A generic ORM that abstracts away SQL entirely (e.g., full Prisma for this use case)** | Prisma's engine/binary overhead and code-gen step are disproportionate for a single-table-family, single-process embedded cache; also complicates Electron packaging (bundling Prisma's native query engine binaries alongside `better-sqlite3`'s own native binary roughly doubles your native-module packaging surface). | drizzle-orm (lighter, no separate query-engine binary, first-class better-sqlite3 support) |

## Stack Patterns by Variant

<desktop-shell-decision>

**Electron vs Tauri — the decision that matters most here:**

Tauri v2 is the technically superior choice on paper: ~10x smaller installers (5-10MB vs 100-150MB), ~5x less RAM (30-50MB vs 150-300MB), a locked-down-by-default permission model, and a built-in delta updater. If this were a public/scaled product, Tauri would be the default recommendation for 2026.

But three project-specific facts point the other way:

1. **Distribution is "a few close users" on Windows, each running the app locally.** Nobody is downloading this over a metered connection or running it on resource-constrained hardware where 150MB vs 10MB or 250MB vs 40MB RAM registers as a real problem. The footprint advantage Tauri offers has no audience here.
2. **The stated skillset is TypeScript + React, not Rust.** Tauri's core is Rust; even the "JS-only" `@tauri-apps/plugin-sql` path still requires a one-time `src-tauri`/Cargo setup, capability/permission config edits, and (for migrations) Rust structs in `lib.rs`. That's a real, non-zero onboarding cost for a developer who has to maintain this solo, versus Electron where `require('better-sqlite3')` in the main process just works with zero new language.
3. **Native access needs are minimal.** The only "native" capability this app needs is local filesystem + SQLite read/write — exactly the capability Electron's Node-in-main-process model handles with the least friction of any option. There's no video processing, no encryption-heavy workload, none of the scenarios where Tauri's Rust-side compute genuinely pays for itself.

**Recommendation: Electron 43.x + electron-vite + electron-builder.** Revisit Tauri only if a future milestone (broader distribution, mobile companion, or genuine footprint complaints) changes the calculus — at that point, migrating the React/chart frontend is largely portable; the persistence and data-source layers should already be abstracted per the project's own stated architecture goals, which also lowers the cost of a later shell swap.

</desktop-shell-decision>

<charting-library-decision>

**Charting library — lightweight-charts is the correct default, with one licensing caveat to resolve early:**

lightweight-charts (TradingView's own OSS library, Apache 2.0, v5.2.0) is purpose-built for exactly this domain: OHLCV candlesticks, native multi-pane support (`paneIndex` on `addSeries`, `series.moveToPane()` — ideal for RSI/MACD/volume sub-panes below the main price pane), a configurable crosshair (`CrosshairMode.Normal`, styled vert/horz lines with labels) that is a required feature here, canvas rendering (10-50x faster than SVG competitors at the bar counts a multi-year 1m cache will accumulate), and a plugin system for custom series/overlays — which maps directly onto the project's "pluggable indicator system" requirement: each indicator can be implemented as a custom series/pane plugin or, more simply, as a derived data series (line/histogram) computed from your own indicator engine and rendered via the standard `addSeries` API into its own pane.

**The caveat:** the license requires displaying a TradingView attribution notice (from the library's `NOTICE` file) with a link to tradingview.com on user-facing pages/screens — there's a built-in `attributionLogo` chart option that satisfies this by rendering a small link directly on the chart. For a personal app shared with a few close users this is a low-stakes, low-cost requirement — leave `attributionLogo` enabled (its default) rather than trying to suppress it, and you're compliant with no extra engineering effort.

**If that attribution ever becomes unacceptable** (e.g., you want a fully white-labeled, TradingView-free chart), Apache ECharts (MIT, no attribution) is the fallback — at the cost of building candlestick rendering, pane-linking, and crosshair sync yourself on top of its general-purpose `grid`/`axisPointer` primitives.

klinecharts (10.0.0, MIT-style, zero-dependency, ~50KB gzip) is a legitimate alternative if you'd rather have dozens of indicators and a trading-terminal multi-pane layout ready out of the box — but since this project explicitly wants a *custom* pluggable indicator system rather than relying on a library's built-in indicator catalog, lightweight-charts' cleaner, lower-level primitives (you control exactly what's computed and rendered) are the better architectural fit.

</charting-library-decision>

<indicator-computation-decision>

**Compute indicators locally, hand-written, not via a bundled indicator library.**

Reasoning: the five requested indicators (SMA/EMA moving averages, Bollinger Bands, Volume, RSI, MACD) are well-documented, numerically stable, small (each is roughly 20-60 lines of TS operating over an array of OHLCV bars), and — critically — the project's own explicit requirement is an *abstracted, pluggable indicator system* ("新しい指標を後から追加できるよう、指標システムを抽象化しておく"). That requirement is best served by a small internal contract like:

```typescript
interface IndicatorPlugin<Params> {
  id: string;
  defaultParams: Params;
  compute(bars: OHLCVBar[], params: Params): IndicatorSeriesOutput; // one or more overlay/pane series
  paneKind: 'overlay' | 'separate-pane';
}
```

where each of the five v1 indicators is a self-contained module implementing this interface, with no dependency on a third-party indicator package's internal data shapes. This keeps the plugin surface entirely under your control (important since "add new indicators later" is a named goal) and avoids depending on `technicalindicators` (unmaintained since 2023).

Use `trading-signals` (actively maintained, Jan 2026, TypeScript-native, supports incremental/streaming updates) in two ways: (1) as a correctness cross-check during development — compute RSI/MACD/Bollinger both ways and diff against your hand-written implementation on real FMP data; (2) as a drop-in adopted dependency instead of hand-rolling, if development time is tighter than expected — its streaming-update design (`update(newBar)` rather than recompute-the-whole-series) is also directly useful once/if you add periodic manual-refresh-triggered recomputation, since you won't want to recompute years of cached RSI on every refresh click, only the new bars.

</indicator-computation-decision>

**If the data-source layer needs to support a second provider (e.g., a Japanese-stock source) later:**
- Define a `DataSourceAdapter` interface now (per PROJECT.md's own stated goal) with methods like `getOHLCV(symbol, timeframe, range)` and `searchSymbols(query)`, and make FMP the first (and for v1, only) implementation.
- Route all fetches through this adapter → TanStack Query → SQLite read-through cache, so a future adapter swap doesn't touch the caching or React-query layers at all — only a new adapter module is added.

**If free-tier FMP rate limits (250 req/day) become a real constraint before upgrading to a paid plan:**
- Make the SQLite cache the source of truth for "have we already fetched this exact symbol+timeframe+range" and skip network calls entirely on a hit — this is already the stated top priority ("API 節約が最優先"), so build the cache-read-through logic before building any UI that could accidentally trigger redundant fetches (e.g., re-fetching daily bars every time a chart mounts instead of once per trading day).
- Design the adapter layer to degrade gracefully when an intraday endpoint is rate-limited or unavailable on the current tier (e.g., surface a "no more requests today" state per timeframe rather than crashing), since FMP's intraday granularity (1m/5m in particular) is more tier-gated in practice than daily/EOD data even where the endpoints technically exist on the free plan.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-------------------|-------|
| `electron-vite@5.0.0` | `vite@^5 \|\| ^6 \|\| ^7` | Does **not** yet declare Vite 8 support (Vite 8.1.5 is current on npm). Pin `vite@7.x` in `package.json` to avoid an unsupported combination. |
| `better-sqlite3@12.x` | Node `20.x/22.x/23.x/24.x/25.x/26.x` — but inside Electron, must be rebuilt against **Electron's** Node ABI, not your system Node | `electron-builder`'s dependency install step (or `@electron/rebuild` as a `postinstall`) handles this automatically; forgetting this step is the #1 source of "cannot find module" / native-binding-mismatch errors when packaging. |
| `drizzle-orm@0.45.x` | `better-sqlite3` (optional peer, install both) | Also lists `@libsql/client` as an alternative optional driver — same ORM works unchanged if you ever migrate to libsql. |
| `lightweight-charts@5.2.0` | React 19 | No React-specific bindings needed/wanted — use it as a plain DOM-mounted chart instance inside a `useEffect`, not via a community React wrapper (most are unmaintained or lag the underlying library's v5 pane API). |
| `typescript@7.0.x` | Editor/tsserver tooling | The native-compiler line is new this cycle; if your editor's TS Language Service integration lags, `typescript@6.0.3` is a safe, fully source-compatible fallback with no code changes required. |

## Sources

- `/tradingview/lightweight-charts` (Context7, HIGH confidence — official repo docs) — panes API, crosshair customization, license/attribution text (`intro.mdx`, `README.md`)
- npm registry `npm view` (HIGH confidence — first-party version/metadata source) — verified current versions for electron, @tauri-apps/cli, lightweight-charts, klinecharts, better-sqlite3, @libsql/client, zustand, jotai, @tanstack/react-query, technicalindicators, drizzle-orm, electron-vite, electron-builder, vite, react, typescript, trading-signals, react-financial-charts, @tauri-apps/plugin-sql, create-tauri-app, axios — including staleness check via `time.modified` and peer-dependency ranges
- WebSearch: "Electron vs Tauri 2026 comparison" (MEDIUM confidence — multiple 2026-dated community/vendor comparison articles, cross-consistent on bundle size/RAM/security tradeoffs) — tech-insider.org, pkgpulse.com guides, rustify.rs, blog.nishikanta.in, dev.to/ottoaria
- WebSearch: "lightweight-charts vs klinecharts vs Highcharts Stock" (MEDIUM confidence) — ejschart.com, klinecharts.com official site, tradingview/lightweight-charts GitHub discussion #2027, highcharts.com official demos
- WebSearch: "better-sqlite3 vs libsql" (MEDIUM confidence) — pkgpulse.com, sqg.dev driver benchmark, rxdb.info Electron database guide, npmjs.com package page
- WebSearch: "FMP API free tier rate limit intraday" (MEDIUM confidence — official FMP site sections returned HTTP 403 to automated WebFetch, so free-tier endpoint gating is triangulated from FMP's own public how-to articles plus third-party review sites, not directly re-verified against the live pricing page in this session) — site.financialmodelingprep.com how-to/FAQ pages (via search snippets), findmymoat.com FMP review
- WebSearch: "Zustand vs Redux Toolkit vs Jotai 2026" (MEDIUM confidence) — betterstack.com community guide, zustand.docs.pmnd.rs official comparison page, dev.to state-management-2026 article
- WebSearch: "tauri-plugin-sql sqlite from JavaScript" (MEDIUM-HIGH confidence — includes official v2.tauri.app plugin docs via search snippet) — v2.tauri.app/plugin/sql, tauri-apps/tauri GitHub discussion #9254

---
*Stack research for: Personal Windows desktop TradingView-alternative charting app (TS + React + FMP)*
*Researched: 2026-07-18*
