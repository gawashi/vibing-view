# Project Research Summary

**Project:** TradingView-alternative personal desktop charting app
**Domain:** Desktop financial charting with local cache and pluggable indicators
**Researched:** 2026-07-18
**Overall Confidence:** HIGH (stack, features, architecture patterns) / MEDIUM (FMP empirical behavior)

## Executive Summary

This is a single-user desktop charting tool to replace TradingView free tier by removing artificial feature caps while keeping costs low via local FMP data caching. Research strongly recommends **Electron + React + TypeScript stack** with canvas-based charting (lightweight-charts), SQLite persistence (better-sqlite3), and pluggable architecture for data providers and indicators.

**Largest risk:** FMP free-tier misuse. Free plan has ~250 req/day with intraday (1m/5m/15m) premium-gated. App must work on free keys during development, requiring runtime capability detection, request budgeting, and graceful degradation.

**Second risk:** Indicator formula correctness. Users immediately notice if RSI/MACD/Bollinger Bands differ from TradingView. Each indicator needs reference verification before shipping.

Stack decisions are high-confidence because they map to project constraints (Windows, TS+React, API-key security, personal/small-group distribution). Feature scope is table-stakes (all must ship v1). Roadmap should sequence data + caching work early to de-risk FMP integration.

## Key Findings

### Recommended Stack

**Shell & Build:**
- **Electron 43.x** — fits TS+React, keeps API key in privileged Node process.
- **electron-vite 5.0.0 + Vite 7.x** — CRITICAL: pin vite@^7; Vite 8.x not compatible.
- **electron-builder 26.x** — produces .exe installer, rebuilds better-sqlite3 for Electron.

**Frontend:**
- **React 19.2.x** — useSyncExternalStore for external-store subscriptions.
- **TypeScript 7.0.x** — safe for greenfield; TS 6.0.3 is fallback.
- **lightweight-charts 5.2.0** — TradingView OSS, canvas-rendered, native multi-pane.

**Persistence:**
- **better-sqlite3 12.x** + **drizzle-orm 0.45.x** — fast native SQLite for desktop.

**State & Data:**
- **Zustand 5.0.x** — minimal, module-level store.
- **TanStack Query 5.101.x** — deduplicates, manages manual refresh.

**Other:** zod, date-fns-tz/Luxon, Vitest + Playwright.

### Expected Features

**Table Stakes:** Symbol search, candlestick rendering, timeframe switching, 5 indicators, toggle/overlay, crosshair, multi-chart, watchlist, layout save/restore, cache, dark theme, data abstraction.

**Differentiators:** Unlimited indicators, unlimited layouts, no ads/login, no bar ceiling, instant cache reload, plugin architecture.

**Defer v2+:** Drawing tools, alerts, streaming, multi-user, broker integration, scripting, screener, backtesting, mobile.

### Architecture

**Process Split (Electron):**
- **Renderer:** UI, indicators, chart rendering. Zero disk/network/key access.
- **Main:** FMP provider, SQLite cache, IPC handlers, safeStorage.
- **Preload:** contextBridge for window.api.* methods.

**Components:** Data-Provider, Cache/Store, Indicator Engine, Chart/Render, Layout/Workspace, Watchlist.

**Patterns:** Cache-first with coverage ledger, native vs derived timeframes, asset-class routing, provisional bars.

### Critical Pitfalls

1. **Free-tier endpoint assumptions** — Intraday premium-gated. Prevention: runtime capability probe.
2. **Rate-limit exhaustion** (~250 req/day). Prevention: centralized budgeter.
3. **Adjusted vs unadjusted prices** — Discontinuity at splits. Prevention: tag and standardize.
4. **Indicator formula mismatches** — Wilder smoothing, EMA seeding, BB stdev. Prevention: test vs TradingView.
5. **Timezone confusion** — US Eastern vs UTC, DST. Prevention: store UTC, render in exchange timezone.

Also critical: Pitfall 9 (API key exposure) and Pitfall 10 (render performance).

## Roadmap Implications

### 7-Phase Structure

**Phase 1:** Foundation — FMP provider, capability probe, rate limiter. De-risk assumptions.
**Phase 2:** Persistence — SQLite cache, coverage ledger, gap detection. Prove core caching.
**Phase 3:** Shell — Electron setup, IPC, API key security. Establish boundaries.
**Phase 4:** Chart Foundation — Single chart, symbol search, candlesticks. End-to-end.
**Phase 5:** Indicators — Plugin architecture, 5 built-ins with TradingView verification.
**Phase 6:** Layouts — Multi-chart grid, watchlist, persistence. V1 goal-line.
**Phase 7:** Polish — Crosshair sync, rate-limit UI, performance tuning.

### Research Flags

**Need research:** Phase 1 (FMP empirical), Phase 2 (holiday calendar, DST), Phase 5 (indicator verification).
**Standard patterns:** Phase 3 (Electron), Phase 4 (lightweight-charts), Phase 6 (React), Phase 7 (optimization).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Electron decision justified; watch Vite 8.x. |
| Features | HIGH | Well-established across platforms. |
| Architecture | HIGH (patterns) / MEDIUM (empirical) | Patterns proven; FMP needs testing. |
| Pitfalls | MEDIUM-HIGH | Formulas HIGH; FMP MEDIUM. |

**Overall:** HIGH on feasibility; MEDIUM on exact FMP details.

### Gaps to Address

- FMP free-tier boundaries, HTTP codes, response formats — Phase 1 testing.
- US market holiday calendar source — Phase 2 design.
- FMP today bar finalization — Phase 1 testing.
- Timezone verification across DST/zones — Phase 2-4.
- Indicator reference values — Phase 5 acceptance.
- Multi-chart performance baseline — Phase 6 testing.

---

*Research synthesis completed: 2026-07-18*
*Ready for roadmap.*
