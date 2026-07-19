---
status: complete
phase: 01-core-pipeline-slice
source: docs/superpowers/plans/2026-07-19-phase1-core-pipeline-slice.md
started: 2026-07-19
updated: 2026-07-19
---

## Current Test

[testing complete]

## Tests

### 1. Unit suite (automated)
expected: vitest run — coverageFromBars, FmpProvider, CacheService, searchCache all pass
result: pass
source: automated

### 2. Typecheck (automated)
expected: tsc --noEmit clean on tsconfig.node.json and tsconfig.web.json
result: pass
source: automated

### 3. Build compiles (automated)
expected: electron-vite build produces out/main, out/preload, out/renderer
result: pass
source: automated

### 4. Cold Start & First-Run Fallback
expected: Dark window opens on AAPL; with a valid saved key, AAPL renders candles
result: pass
note: initially blank due to FMP 403 (v3 deprecated). After switching FmpProvider to /stable endpoints + restart, AAPL renders candles on startup. Root cause fixed — see gap G-01-4.

### 5. Save API Key (Settings)
expected: Settings dialog saves a real FMP key; key is used for fetches
result: pass
note: proven transitively — chart only renders because the saved key was decrypted and used for the /stable fetch

### 7. Chart Renders
expected: Daily candlesticks render for AAPL — dark background
result: pass
note: confirmed by user — AAPL candlestick chart displayed after the /stable fix

### 6. Search + Select
expected: Type AAPL + Enter → up to 8 result rows (symbol/name/exchange); click sets header + loads chart
result: pass

### 8. Switch Symbol
expected: Search a second symbol (MSFT or BTCUSD), select → chart switches
result: pass

### 9. Cache Hit — No Refetch
expected: Re-select AAPL after MSFT → no FMP historical request fires (served from SQLite)
result: pass

### 10. Key Security
expected: window.api.apikey.status() returns {hasKey,encryptionAvailable}, never the key; apikey.enc not human-readable
result: pass

### 11. Persistence Across Restart
expected: Relaunch → opens on last-selected symbol, chart renders from cache, no FMP call
result: pass

## Summary

total: 11
passed: 11
issues: 0
pending: 0
skipped: 0

## Gaps

- gap_id: G-01-4
  truth: "With a valid saved FMP key, AAPL auto-loads on startup and renders daily candles (or shows the error copy) — never a silent blank chart"
  status: resolved
  reason: "User reported: app opens on AAPL but chart area is blank — no candles, no loading text, no error message"
  resolved_by: "FmpProvider switched from deprecated /api/v3 (403) to /stable endpoints; user confirmed AAPL candles render after restart"
  severity: major
  test: 4
  root_cause: "FMP deprecated /api/v3 (returns HTTP 403 for current keys). FmpProvider used /api/v3/historical-price-full and /api/v3/search — both 403. Confirmed via DevTools: 'Error: FMP HTTP 403'."
  artifacts:
    - path: "src/main/providers/FmpProvider.ts"
      issue: "used /api/v3 endpoints (403)"
    - path: "src/main/providers/fmp.schema.ts"
      issue: "v3 response shapes (historical wrapper object, exchangeShortName)"
  missing:
    - "Switch BASE to /stable; search-symbol; historical-price-eod/full?symbol=; flat-array shape; exchange field"
  fix_applied: "commit-pending — BASE=/stable, endpoints + zod shapes updated, fixtures+tests updated. 12/12 tests + typecheck green. Awaiting real-key smoke re-test."
  status_note: "PENDING RE-VERIFICATION with real FMP key in running app"
