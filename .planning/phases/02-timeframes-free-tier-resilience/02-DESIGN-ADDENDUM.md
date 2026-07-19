# Phase 2: Timeframes & Free-Tier Resilience — Design Addendum

**Date:** 2026-07-19
**Status:** Approved
**Purpose:** Resolve the "Claude's Discretion" technical items left open in `02-CONTEXT.md`.
All user-facing decisions (D-10–D-21) and the UI-SPEC remain the governing contract; this
only pins the implementation-detail calls the planner needs. Grounded in the committed P1 code
(`72e150a`).

---

## 1. Coverage model (extends D-09)

Keep the single-interval coverage `[oldest, newest]` per `(symbol, tf)`. A pan-left gap fetches
`[targetFrom, oldestCached − 1 bar]`, contiguous with existing coverage, so no holes appear. No
multi-interval model in P2 (deferred — see CONTEXT.md).

## 2. `Timeframe` widening

```
type Timeframe = '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | '1M'
```

- **Fetchable from FMP:** `1m, 5m, 15m, 1h, 1d`
- **Derived (never fetched/cached):** `1w, 1M` — aggregated from cached `1d` bars (§6). Their
  coverage is the daily coverage.

## 3. FMP endpoints

- **Daily:** unchanged — `/stable/historical-price-eod/full?symbol&apikey`.
- **Intraday:** `/stable/historical-chart/{1min|5min|15min|1hour}?symbol&from&to&apikey`.
- Same newest-first → ascending normalize as daily.
- Intraday timestamps are exchange-local → convert with `date-fns-tz` (`America/New_York`) to UTC
  epoch seconds. Daily stays date-keyed at 00:00Z as in P1.

## 4. Intraday initial fetch span (D-18)

One request per timeframe on first load; older history arrives via pan (§5):

| TF | Initial span |
|----|--------------|
| 1m | last 5 trading days |
| 5m | last 1 month |
| 15m | last 3 months |
| 1h | last 1 year |

## 5. Pan gap-fetch (D-16)

- Subscribe `timeScale().subscribeVisibleLogicalRangeChange` in `Chart.tsx`.
- Debounce **300ms**.
- On left-edge approach, fetch the missing left sub-range plus a prefetch pad of one
  visible-range width.
- Single-flight guard per `(symbol, tf)` so overlapping pan events don't double-fetch.

## 6. Weekly / monthly derivation (D-17)

- Derive layer in **main**, computed on read from cached daily bars (no W/M cache table).
- **Week = Monday-start** (TradingView stock convention); **Month = calendar month**.
- Boundaries cut on `America/New_York` date.
- Aggregation per bucket: `open` = first, `high` = max, `low` = min, `close` = last,
  `volume` = sum.

## 7. Capability classifier (D-19 / D-20)

One centralized function classifies each FMP response. Response conditions are MEDIUM-confidence
until verified against a real key — this is the single place to tune.

- **requires-plan** (sticky): HTTP 403, or HTTP-200 error-shaped payload (zod parse fails), or a
  message containing premium / exclusive / legacy wording.
- **rate-limited** (transient): HTTP 429, or a rate-limit message.

`// ponytail:` mark the classifier — response-shape conditions are a known tuning point pending
real-key verification.

## 8. Capability cache (D-21)

- File `capabilities.json` under `app.getPath('userData')`, alongside existing settings.
- Keyed by `hash(apiKey)`; per-tf status: `available | requires-plan | rate-limited | unknown`.
- No TTL. Cleared on API-key change. Each tf lazily probed on first request.
- `rate-limited` entries expire at the next UTC day (transient → retry tomorrow);
  `requires-plan` persists until key change.

## 9. IPC

- New channel `capabilities.get()` → per-tf status map for the renderer's button row.
- Extend `getOHLCV` IPC to pass `timeframe` + `range`.
- Renderer wires chart visible-range change → gap-fetch IPC (§5).

---

## Verify during implementation

- **FMP free-tier reality** (STATE.md blocker, MEDIUM confidence): whether intraday is served at
  all on the free tier, exact HTTP codes, and error-payload shapes. Confirm the §7 classifier and
  §3 endpoints against a real key before locking the response conditions.
