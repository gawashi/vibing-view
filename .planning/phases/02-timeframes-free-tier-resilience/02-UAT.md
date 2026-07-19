---
status: partial
phase: 02-timeframes-free-tier-resilience
source: [02-01-PLAN.md, 02-02-PLAN.md, 02-03-PLAN.md, 02-04-PLAN.md, 02-05-PLAN.md]
started: 2026-07-19T07:19:54Z
updated: 2026-07-19T08:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running dev instance. Start `npm run dev` fresh. Window opens without errors, a symbol loads, daily chart renders ascending candles. No blank screen / boot crash.
result: pass

### 2. Timeframe Switching (intraday + daily)
expected: The row shows exactly 7 buttons — 1m 5m 15m 1h D W M — in that order, with D active by default. Clicking 1h / 5m / 15m / 1m each repaints ascending candles and snaps the view to the latest bars. Clicking D returns to daily. The button row never reflows/shifts when switching.
result: pass
note: "Passed after direct inline fixes (user chose direct-apply over --gaps-only). Original report: 'WとMを押したらチャートが消えた、1m~1hは押しても何も起こらない' (severity: blocker). Root cause + fixes recorded in gap G-02-2 (resolved)."

### 3. Weekly / Monthly derived from cache (no network)
expected: With a symbol's daily bars already cached (view D first), open DevTools → Network, click W then M. Each renders coarser weekly / monthly candles, and NO new FMP request fires (aggregation is local). A weekly candle's high equals the max daily high in that Mon–Fri week.
result: pass

### 4. Pan-left gap-fetch (narrowed range only)
expected: On an intraday timeframe (e.g. 1h), pan LEFT into older history. Exactly one FMP historical-chart request fires per pan-into-gap (after ~300ms debounce), covering ONLY the missing older window — not full history, not already-loaded bars. Existing candles stay on screen (no full-chart "Loading" flash); a subtle indicator shows briefly. Rapid back-and-forth panning does not burst duplicate requests.
result: blocked
blocked_by: third-party
reason: "フリープランなのでintraday timeframeを表示できない — intraday is gated on the free FMP key, so pan-fetch of intraday history can't be exercised. Requires a paid key."

### 5. Gated timeframe buttons (requires-plan / rate-limited)
expected: With a free-tier key, intraday timeframes the tier can't serve render grayed + unselectable with a Lock badge; hovering shows "Requires a paid FMP plan. Your current key doesn't support this timeframe." Rate-limited ones show a Clock badge with a distinct tooltip. Buttons don't flash-then-demote on first load; the row never goes blank. D/W/M stay active.
result: pass

### 6. Mid-session rate-limit toast (cached bars preserved)
expected: While viewing an active timeframe, exhausting the daily budget fires a single toast "Rate limit reached for {tf}. Showing cached data — new bars will load once the limit resets." The existing candles stay on screen — the chart does not blank or error.
result: skipped
reason: "Hard to force a live 429 on demand; user requested code inspection instead. Verified: toast is driven off the capabilities map (App.tsx:69-80), fires once per symbol:tf transition via toastedFor dedup; gap-fetch failure (Chart.tsx:100-111) only invalidates the capabilities query and never touches q.data (staleTime:Infinity), so cached candles stay on screen. Behavior matches expectation. Out-of-scope caveat: a fresh 429 on a tf with NO cache shows the generic 'Couldn't load' message (isCoverageError matches only 402/403, not 429) — not part of test 6's cached-bars scenario."

### 7. Re-enable on paid key
expected: Entering a paid FMP key in Settings re-enables previously-locked intraday buttons without restarting the app (capabilities re-probe on key change).
result: blocked
blocked_by: third-party
reason: "No paid FMP key available to test re-enable behavior."

## Summary

total: 7
passed: 4
issues: 0
pending: 0
skipped: 1
blocked: 2

note: "Out-of-band blocker G-02-8 (out-of-plan symbols: D grayed + repeated FMP calls) found+resolved inline mid-run. Resuming from test 4."

## Gaps

- gap_id: G-02-9
  truth: "The coverage message ('This symbol isn't available on your current FMP plan.') fully covers the chart area — no residual axis/grid from the previously-viewed covered symbol shows behind it."
  status: resolved
  resolved_by: "inline fix (Chart.tsx: added bg-background to the notCovered + generic-error overlays)"
  resolved_at: 2026-07-19
  reason: "User reported: AAPLなどの対象銘柄を表示した後にQQQなどの非対称銘柄を見ると、coverageメッセージの背景に目盛りが残っている"
  severity: cosmetic
  test: null
  discovered: "out-of-band, during UAT completion review"
  root_cause: "The 'no chart' overlays (Chart.tsx notCovered/error) were absolute inset-0 z-10 but had NO background — transparent text over the canvas. On a covered→uncovered symbol switch the candles clear (setData([])), but lightweight-charts still renders the price/time axis grid for the empty series, which showed through the transparent overlay."
  artifacts:
    - path: "src/renderer/components/Chart.tsx"
      issue: "coverage + error overlays lacked an opaque background, so residual axis ticks bled through"
  fix_applied:
    - "Added bg-background to both persistent 'no chart' overlays so residual grid/axis can never show behind the message. typecheck passes."

- gap_id: G-02-2
  truth: "Clicking any of 1m/5m/15m/1h/D/W/M switches the chart to that timeframe and renders candles"
  status: resolved
  resolved_by: "inline fixes (Chart.tsx gap-fetch dedup + skip-derived; capabilityClassifier.ts 402→requires-plan; App.tsx eager-probe + auto-revert-to-D; TimeframeRow.tsx tooltip-on-span)"
  resolved_at: 2026-07-19
  secondary_fixes:
    - "402 (Payment Required) was misclassified as 'available' → now requires-plan (real free-tier intraday signal; empty-200 assumption was wrong and reverted)"
    - "Intraday now greyed from startup via one-time eager probe per key (user override of D-21)"
    - "Gated-button tooltip moved to non-disabled <span> wrapper so hover fires on disabled items"
    - "Selected tf that resolves requires-plan auto-reverts to D so the chart never shows a broken state (phase goal)"
  reason: "User reported: WとMを押したらチャートが消えた、1m~1hは押しても何も起こらない"
  severity: blocker
  test: 2
  root_cause: "Chart.tsx runGapFetch fires on W/M switch (fitContent puts view at left edge, range.from<=1). For derived tf CacheService ignores the sub-range and returns the FULL weekly/monthly series as 'older'; the merge [...older, ...barsRef].sort() (Chart.tsx:89) does not dedupe, so every bar is duplicated. setData then throws 'data must be asc ordered by time' → <Chart> crashes → chart disappears. Reproduced: deriveMonthly(AAPL)=0 dups; merge(full+full)=61 dups, first two=1625097600 == console assertion."
  artifacts:
    - path: "src/renderer/components/Chart.tsx"
      issue: "gap-fetch runs for derived '1w'/'1M' (nothing to backfill) AND the merge does not dedupe by time → duplicate timestamps crash setData"
  missing:
    - "Skip runGapFetch for '1w'/'1M' (derived — full history already aggregated)"
    - "Dedupe merged bars by time before setQueryData (defensive for real-tf overlap too)"
  secondary_finding: "Intraday (1m/5m/15m/1h) returns an EMPTY array on this key; classify(200, []) => 'available' so buttons stay enabled but the chart blanks with no gated state (violates D-15). Separate from the crash — needs a decision on whether empty-intraday should classify as requires-plan/gated."

- gap_id: G-02-8
  truth: "Viewing a symbol outside the FMP free-plan coverage never disables the daily (D) button — D/W/M stay active per phase goal; the symbol just shows an explanatory chart message; and switching D/W/M does not re-hit FMP for a symbol already known to be out of plan."
  status: resolved
  resolved_by: "inline fixes (ipc.ts per-symbol dailyOutOfPlan short-circuit + no requires-plan for 1d; Chart.tsx coverage message for 402/403 or empty + clear-series-on-switch + z-10 overlay; main.tsx retryOnMount:false + retry:0)"
  resolved_at: 2026-07-19
  reason: "User reported: FMP無料プランの対象外の銘柄のチャートを見ようとしたらDがグレーアウトされた (and it stayed grey for all symbols on that key)"
  severity: blocker
  test: null
  discovered: "out-of-band, during test 4 setup — user aborted the run"
  root_cause: "capabilityCache is keyed by (apiKey × timeframe), NOT symbol. An out-of-coverage symbol's daily fetch returns 402/403; ipc.ts classified it as requires-plan and stored it as the key-wide '1d' verdict, so D greyed out for every symbol. App.tsx:66's 'always revert to 1d' assumed '1d' is never requires-plan — violated. A per-symbol coverage failure was misattributed to a per-key timeframe capability. (FMP has no plan/subscription introspection API, and it wouldn't help — coverage is per-symbol.)"
  artifacts:
    - path: "src/main/ipc.ts"
      issue: "ohlcv:get catch recorded requires-plan for '1d' on 402/403, poisoning the key-wide daily verdict"
    - path: "src/renderer/components/Chart.tsx"
      issue: "402/403 on the active fetch showed a generic connection/key error, not a symbol-coverage message"
  fix_applied:
    - "ipc.ts: never record requires-plan for '1d' — daily is a free-tier capability, so a 402/403 there is a symbol-coverage signal, not a plan-gate. Rate-limit (transient) still records for '1d'."
    - "Chart.tsx: show 'This symbol isn’t available on your current FMP plan.' for BOTH manifestations of an out-of-coverage symbol on this key — a 402/403 error AND a plain empty-200 array."
    - "Chart.tsx (Fix 3): clear the candlestick series to [] on symbol/timeframe switch instead of bailing on !q.data — an errored/loading new symbol was leaving the PREVIOUS symbol's candles on screen (QQQ header + AAPL candles). This stale-chart bug was the real cause of 'nothing changed' across several test rounds."
    - "Chart.tsx (Fix 4): overlays given z-10 + centered — the coverage/error message was painting behind lightweight-charts' canvas."
    - "main.tsx (Fix 5): retryOnMount:false + retry:0. retryOnMount defaults true → re-subscribing on each tf switch retried an errored query; retry:1 doubled every failed fetch. Both re-hit FMP for a deterministic out-of-plan 402. (Covered symbols were never affected — successful queries reuse cache via staleTime:Infinity.)"
    - "ipc.ts (Fix 6, ROOT FIX): per-symbol in-memory 'dailyOutOfPlan' Set. On a 402/403 for any daily-backed tf (1d/1w/1M — W/M derive from 1d), the symbol is recorded; subsequent D/W/M switches short-circuit to [] WITHOUT calling FMP (and without throwing → no 402 console spam → renderer shows the coverage message via its empty-state). Cleared on key change so a paid key re-probes. This is what the earlier per-query TanStack tweaks were only half-addressing: the real waste was D, W AND M each independently funnelling to the same failing daily fetch on every switch."
  verification: "typecheck + 48 unit tests pass; awaiting user re-test — (a) QQQ chart blanks + centered coverage message; (b) repeated D/1h clicks on QQQ hit FMP only once per session (no 402 spam in main console)."
