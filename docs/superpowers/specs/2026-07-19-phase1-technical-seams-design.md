# Phase 1 — Technical Seams Design

**Date:** 2026-07-19
**Phase:** 1 — Core Pipeline Slice
**Status:** Approved (design), ready for planning
**Scope:** The architecture/technical decisions that Phase 1's `01-CONTEXT.md` deferred to
"planner/Claude's discretion". Product and UI design are already locked in
`01-CONTEXT.md` (decisions D-01…D-09) and `01-UI-SPEC.md` (approved 6/6); this doc does **not**
restate them, it fills the technical seams underneath them.

## Purpose

Resolve, before planning:

- `IDataProvider` interface shape and where read-through caching lives
- SQLite (drizzle) table definitions and the `[oldest, newest]` coverage model's concrete form
- IPC channel design/schemas and the key-never-crosses-outbound rule
- zod validation boundary
- Small-defaults: search-result cache, fallback symbol, last-symbol storage

## Process layering

Main process owns everything sensitive. Renderer never sees the API key and never calls FMP.

```
renderer (React)                    main process                         disk
─────────────────                   ────────────────                     ──────
Zustand: activeSymbol   ── IPC ─▶   IPC handlers                         SQLite (drizzle)
TanStack Query          ◀─ IPC ──   ├─ CacheService (orchestrator)  ◀─▶  bars + coverage tables
lightweight-charts                  │    ├─ reads coverage
                                    │    └─ calls provider for gaps        userData/
                                    ├─ IDataProvider ──▶ FMP (fetch)       ├─ apikey.enc (safeStorage)
                                    ├─ safeStorage (key)                   └─ settings.json (last symbol)
                                    └─ zod-validate at FMP boundary
```

TanStack Query's `queryFn` calls IPC, not the network. It dedupes/caches at the UI layer in
front of the SQLite read-through in main.

## Decision 1 — read-through placement (APPROVED)

`IDataProvider` is a **pure network adapter** (FMP only, ignorant of caching). A separate
`CacheService` in main orchestrates coverage-check → provider-fetch-gaps → write cache → return.

Rationale: keeps the provider seam swappable and dumb; matches "SQLite is the source of truth"
being a layer *above* the provider. Rejected alternative: read-through inside a caching provider
wrapper — tangles two concerns and forces a second provider to re-implement caching.

## Decision 2 — coverage model (APPROVED)

An **explicit `coverage` table** holds one `[oldest_time, newest_time]` row per
`(symbol, timeframe)`.

Rationale: it is the stated P2 foundation (gap fetching on pan), and it correctly distinguishes
"fetched this range, market holidays included" from "range never fetched" — which deriving
coverage from `MIN/MAX(ts)` of the bars table cannot. Rejected alternative: derive from min/max —
lazier for P1 alone, but a holiday gap becomes indistinguishable from an un-fetched gap in P2,
forcing a rewrite.

## Shared data types

`src/shared/types.ts`:

```ts
type Timeframe = '1d';                    // P1 ships daily only; type is the P2 extension point
type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
                                          // time = UTC epoch seconds (lightweight-charts native)
type SymbolResult = { symbol: string; name: string; exchange: string };
type DateRange = { from: number; to: number } | undefined;  // undefined = all available
```

## IDataProvider

`src/main/providers/IDataProvider.ts`:

```ts
interface IDataProvider {
  searchSymbols(query: string): Promise<SymbolResult[]>;
  getOHLCV(symbol: string, timeframe: Timeframe, range: DateRange): Promise<Bar[]>;
}
```

`FmpProvider` implements it, holds the decrypted key in-memory only, and validates every response
with zod (`src/main/providers/fmp.schema.ts`) before returning. A malformed/error-shaped payload
(FMP can return error bodies with HTTP 200) is rejected and never written to the cache.

## SQLite schema

drizzle, `src/main/db/schema.ts`. DB file at `app.getPath('userData')/cache.db`.
`better-sqlite3` rebuilt against Electron's ABI via electron-builder / `@electron/rebuild`.

```
bars      = table('bars', {
  symbol, timeframe, time (epoch seconds),
  open, high, low, close, volume,
}, primaryKey(symbol, timeframe, time));

coverage  = table('coverage', {
  symbol, timeframe,
  oldestTime, newestTime,
}, primaryKey(symbol, timeframe));
```

## CacheService orchestration

`src/main/cache/CacheService.ts`:

```
getOHLCV(symbol, tf, requestedRange):
  cov = coverage[symbol, tf]
  if cov exists and covers requestedRange (or requestedRange undefined and cov exists):
     return bars from SQLite               ← no network
  else:
     bars = provider.getOHLCV(...)          ← P1: fetch-all-history (D-08)
     upsert bars; upsert coverage = [min(time), max(time)]
     return bars
```

P1 only ever fetches all-history, so gap math is trivial (a miss = no coverage row). P2 slots
sub-range gap logic into this one method without touching the provider or IPC.

## IPC contract

Typed, exposed via `contextBridge` in `src/preload/index.ts`. `invoke`/`handle` pattern.

| Channel | Args → Return | Notes |
|---|---|---|
| `symbols:search` | `query` → `SymbolResult[]` | in-memory `Map` cache, 5-min TTL |
| `ohlcv:get` | `{symbol, timeframe, range}` → `Bar[]` | routes to CacheService |
| `apikey:set` | `key` → `{ok, encryptionAvailable}` | safeStorage encrypt → `userData/apikey.enc` |
| `apikey:status` | → `{hasKey, encryptionAvailable}` | drives settings UI + D-05 warning |
| `apikey:clear` | → `void` | destructive-confirm in UI |
| `settings:getLastSymbol` | → `string \| null` | `userData/settings.json` |
| `settings:setLastSymbol` | `symbol` → `void` | written on symbol change |

**The key never crosses IPC outbound.** Renderer sends it once on `apikey:set`; thereafter it only
receives results. `apikey:status` returns booleans, never the key. FMP calls happen only in main.
When `safeStorage.isEncryptionAvailable()` is false, `apikey:set`/`apikey:status` report
`encryptionAvailable: false` so the UI shows the D-05 warning instead of silently storing plaintext.

## Renderer wiring

- Zustand (`src/renderer/store.ts`): `activeSymbol` only.
- TanStack Query: `queryFn` → thin `window.api` wrappers (`src/renderer/api.ts`). `staleTime: Infinity`
  for OHLCV (main's cache is authoritative); manual `invalidate` reserved for a future refresh button.
- lightweight-charts: mounted in a `useEffect`, dark theme, `#22C55E` / `#EF4444` candles per UI-SPEC.
- Startup: `settings:getLastSymbol` → fallback `AAPL` (D-06/D-07).

## File tree

```
src/
  main/
    index.ts                 electron entry, window, IPC registration
    ipc.ts                   handler wiring
    db/{client.ts,schema.ts}
    cache/CacheService.ts
    providers/{IDataProvider.ts,FmpProvider.ts,fmp.schema.ts}   ← zod here
    keystore.ts              safeStorage encrypt/decrypt + status
    settings.ts              last-symbol JSON
  preload/index.ts           contextBridge typed api
  renderer/
    App.tsx, main.tsx
    components/{SearchBar,SearchResults,Chart,SettingsDialog,ErrorState}.tsx
    store.ts                 Zustand
    api.ts                   thin typed wrappers over window.api
  shared/types.ts
```

## Small defaults (deliberate, low-stakes)

- Search-result cache: in-memory `Map`, 5-min TTL. Cleared on process exit.
- Fallback symbol: `AAPL`.
- Last-symbol storage: plain `userData/settings.json` (no `electron-store` dependency — one small
  read-whole-file config).
- zod: validate FMP payloads at the adapter boundary; reject → never write cache.

## Out of scope (P2+, do not build now)

Timeframe switching / sub-range gap fetch, pan/zoom, free-tier degradation, indicators, panes,
crosshair, multi-chart layouts, watchlist, layout persistence. The `Timeframe` type, the
`coverage` interval model, and the `CacheService.getOHLCV` gap branch are the seams left ready for
P2; nothing beyond P1 is implemented.
