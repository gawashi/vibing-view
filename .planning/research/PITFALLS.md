# Pitfalls Research

**Domain:** Personal desktop charting app (TradingView alternative) — TypeScript + React, FMP data, local price cache, pluggable indicators
**Researched:** 2026-07-18
**Confidence:** MEDIUM-HIGH (FMP exact rate-limit numbers vary by source and change over time; indicator-math and Electron-security findings are HIGH confidence from official docs/well-established convention)

## Critical Pitfalls

### Pitfall 1: Building against FMP's paid-tier response shape, then breaking on free tier (or vice versa)

**What goes wrong:**
Intraday granularity (1min/5min/15m/1h) and technical-indicator endpoints are premium-gated on FMP — the free "Basic" tier is effectively an EOD (daily) sandbox with ~250 requests/day and a small (~500MB/30-day) bandwidth cap. If the app is coded assuming intraday data is always available, every intraday timeframe silently breaks (empty response, 401/403, or a paywall error payload disguised as 200 OK) the whole time development happens on the free key. Conversely, if the developer just special-cases "handle missing intraday gracefully" and never revisits it, the paid upgrade won't automatically unlock 1m/5m/15m in the UI, or worse the degraded-mode UI ("upgrade required") stays visible forever.

**Why it happens:**
FMP's docs and pricing page describe tier gating loosely ("Premium plan adds intraday charts, technical indicators..."), and the free vs paid boundary has shifted across FMP's plan history — code and blog posts from a year ago may describe access that's no longer free. Developers test once against whatever tier they currently have and hard-code the assumption.

**How to avoid:**
- Treat "which timeframes/endpoints are available" as a runtime-detected capability, not a compile-time assumption: on API key setup/validation, probe each endpoint class once (EOD daily, intraday 1m/5m/15m/1h) and cache the capability result per API key.
- Design the timeframe selector UI to show intraday buttons as disabled/"requires paid plan" when the probe fails with a plan-restriction error (distinct from a transient network error), rather than crashing or silently showing no data.
- On 402/403-style plan-restriction responses, surface a specific "this data requires a higher FMP plan" message distinct from generic errors, so the failure mode is diagnosable instead of looking like a bug.
- Re-run the capability probe after every API key change (including re-entering the same key after an upgrade) so paid access is picked up without a code change.
- Do not hard-code "free tier = no intraday" as a permanent UI branch — make it data-driven from the probe so the single codebase serves both dev (free) and later (paid) without a redeploy.

**Warning signs:**
- Intraday chart requests return 200 with an empty array rather than an explicit error — easy to misdiagnose as "no data for this symbol" instead of "plan restriction."
- Code has a hardcoded `if (isFreeTier)` flag instead of a capability check derived from actual API responses.

**Phase to address:** Data-layer / FMP provider integration phase (early, before charting UI is built on top of assumed-available intraday data).

---

### Pitfall 2: Free-tier rate limit exhaustion during normal development/backfill

**What goes wrong:**
Backfilling history for a watchlist of even 10-20 symbols across 6 timeframes, each needing potentially years of daily bars plus recent intraday bars, can burn through a ~250-300 requests/day free-tier cap in minutes if each (symbol, timeframe) pair is a separate call issued without throttling. The dev then sees a wall of failures for the rest of the day and may misattribute it to bugs in parsing/auth rather than quota exhaustion, wasting a debugging session.

**Why it happens:**
FMP's free plan is designed for testing/exploration, not building request volume backfills; the request budget is easy to underestimate because a "watchlist" naturally multiplies symbols × timeframes × (possible pagination pages).

**How to avoid:**
- Build a centralized request budget/rate limiter in the data layer from day one (token-bucket or simple daily counter persisted locally), configurable per API key/plan, that the whole app funnels through — never call `fetch` to FMP directly from UI/indicator code.
- Log remaining budget and surface it in a dev-only status indicator so exhaustion is visible immediately, not inferred from mysterious empty charts.
- Prioritize fetch order: only fetch the active chart's visible range + a buffer first; defer full-history backfill and background prefetch for other watchlist symbols to idle time or explicit user action.
- Treat HTTP 429 (or FMP's equivalent limit-exceeded payload) as a distinct, cached "backed off until X" state — don't retry-storm.

**Warning signs:**
- Random-looking failures that correlate with time-of-day (i.e., "it always breaks after I've been testing for 20 minutes").
- No visibility into how many requests have been made today.

**Phase to address:** Data-layer / provider integration phase — build the rate limiter alongside the first fetch call, not as an afterthought.

---

### Pitfall 3: Mixing adjusted and unadjusted prices inconsistently

**What goes wrong:**
FMP exposes both a dividend/split-adjusted endpoint and a raw unadjusted endpoint for equities. If the cache stores data fetched from one endpoint on one date and the other endpoint on a later date (e.g., after switching code or providers), candles before/after a stock split or large dividend will show a visible discontinuity (a "cliff" in price) that doesn't correspond to a real market event, and any indicator computed across that boundary (MA, BB, RSI) will be corrupted around the seam. Crypto has no splits/dividends, so this pitfall is equity-only — mixing the two asset classes in the same caching/normalization code path without branching on it is itself a related mistake.

**Why it happens:**
"Adjusted" sounds like the obviously-correct default, so developers pick it without deciding — and documenting — that decision project-wide; later, a different code path (e.g., a different indicator or a manual backfill script) queries the unadjusted endpoint "because it looked more precise" and the two get cached side by side.

**How to avoid:**
- Make one explicit, documented decision up front: standardize on split/dividend-adjusted close prices for all equity candle storage and indicator computation (this is what TradingView shows by default and is what makes indicator values comparable across time). Never store both variants in the same cache table without a discriminating column.
- Store an explicit `adjustment: "adjusted" | "unadjusted"` tag per cached bar/series so any future mixing is a loud schema violation, not a silent data-quality bug.
- When a stock split occurs during the app's lifetime, do a full re-fetch/re-normalize of that symbol's historical range rather than trying to patch in the new split ratio locally — FMP's adjusted endpoint already retroactively re-divides history, so the local cache must treat previously-cached "adjusted" bars for that symbol as stale after a detected split.
- For crypto, skip the adjustment question entirely (no splits/dividends) but keep the same schema field for consistency (e.g., `adjustment: "n/a"`).

**Warning signs:**
- A visible vertical jump in the candlestick chart with no corresponding news/split event.
- MA/BB/RSI values that look correct after a certain date but wrong (huge stddev, wrong RSI extremes) before it.

**Phase to address:** Data-layer / caching schema design phase (must be decided before the cache schema is finalized, since retrofitting a discriminator column onto existing cached data is painful).

---

### Pitfall 4: Symbol-format mismatches between equities and crypto breaking the "provider-agnostic" abstraction

**What goes wrong:**
FMP uses plain tickers for equities (`AAPL`) but a concatenated base+quote convention for crypto (`BTCUSD`, no separator, no exchange qualifier) — and the crypto historical endpoints partially reuse the same URL patterns as equities in the older v3 API while the newer "stable" API has separate, explicitly-named crypto endpoints. If the data-source abstraction layer assumes "a symbol is just a string passed to the same endpoint," searching/watchlist code will either (a) fail to disambiguate `BTCUSD` from an equity ticker that happens to collide, or (b) silently call the wrong endpoint family for crypto (e.g., trying to fetch adjusted-price crypto data, which doesn't exist since crypto has no corporate actions).

**Why it happens:**
The abstraction is designed against equities first (since that's the primary asset class), and crypto support gets bolted on later by just substituting the symbol string into the same request-building code, which happens to often "work" for basic OHLCV but silently diverges for adjustment/endpoint-family edge cases.

**How to avoid:**
- Model "instrument" as a tagged type from the start: `{ symbol: string, assetClass: "equity" | "crypto" }`, and route to asset-class-specific endpoint builders in the provider adapter, not a single generic URL template.
- In the watchlist/search UI, disambiguate and label asset class explicitly (e.g., show a "crypto" badge) so users and the cache layer never have to guess from the symbol string alone.
- Since this project's provider layer is meant to be pluggable for future providers too, define the asset-class field at the abstraction boundary (not FMP-specific), so a future non-FMP crypto or equity provider slots in without redesigning the type.

**Warning signs:**
- Any code that builds an FMP URL by only interpolating `symbol` with no asset-class branch.
- Adjusted-price fields appearing (or being expected) in crypto cache rows.

**Phase to address:** Data-source abstraction design phase (before the first crypto symbol is wired in) — data-layer / provider integration phase.

---

### Pitfall 5: Candle timezone confusion — exchange time vs UTC vs local machine time

**What goes wrong:**
FMP timestamps are commonly in US Eastern (exchange) time for US equities but crypto trades 24/7 with no single "exchange session" — mixing these under one "just parse as a Date and display" strategy causes daily candles to appear to start/end at the wrong hour, weekly candles to bucket the wrong days together, and — critically — the crosshair's displayed time can be off by hours from what TradingView shows, which is exactly the kind of subtle correctness bug a solo user will notice immediately and lose trust over.

**Why it happens:**
JavaScript's `Date` silently assumes local timezone or UTC depending on the string format parsed, and "local machine time" (the developer's dev box, likely JST for this project) differs from both UTC and US market time — a daily bar's UTC midnight boundary and US market midnight boundary are 4-5 hours apart, so daily/weekly bucket boundaries computed carelessly will assign some bars to the wrong day/week.

**How to avoid:**
- Decide and document one canonical internal representation: store all bar timestamps as UTC epoch/ISO in the cache (unambiguous, sortable, portable), and treat "exchange session day" as a derived display concept, not the storage format.
- For daily/weekly/monthly aggregation and gap detection, bucket using the **exchange's trading-day calendar** (US market day boundary, i.e., a session that runs 9:30am-4:00pm US/Eastern, with the "trading day" for after/pre-market data or for defining daily-candle boundaries anchored to US/Eastern midnight-to-midnight, not UTC midnight) for equities; for crypto, a straightforward UTC-day bucketing is the market convention (most charting platforms bucket crypto daily candles at UTC 00:00).
- Do all timezone-aware date-math with a proper timezone library (e.g., `date-fns-tz`, `Luxon`, or the built-in `Intl`/`Temporal`-based approach) rather than manual offset arithmetic — manual UTC-offset math breaks across DST transitions.
- Render the crosshair and axis labels in the instrument's exchange timezone (not the user's local machine timezone) by default, matching TradingView's convention, with local-time display as an optional toggle if desired later.

**Warning signs:**
- Daily candle "date" sometimes shows the previous day compared to the FMP raw timestamp.
- Weekly candles occasionally include an extra/missing day at a week boundary.
- Any code doing `date.getHours()` / `new Date(dateString)` without an explicit timezone context.

**Phase to address:** Data-layer / candle normalization phase (charting foundation phase) — this must be correct before aggregation and indicators are built on top of it, since a timezone bug is very expensive to unwind once data is cached in the wrong bucketing.

---

### Pitfall 6: DST transitions and market holidays silently corrupting intraday aggregation and gap-fill logic

**What goes wrong:**
Twice a year, US market DST transitions shift the UTC offset of "9:30am Eastern" by an hour; a naive fixed-offset conversion (e.g., hardcoding "Eastern = UTC-5") will misalign intraday candle boundaries and gap-detection logic around those transition dates, causing either a spurious "gap" to be detected (triggering an unnecessary re-fetch) or a real gap to be missed (leaving a hole in the cache that's never backfilled). Separately, market holidays and half-days (weekends, Thanksgiving, early closes) are not just "missing data" — if gap-detection logic assumes every weekday must have a bar, holidays will be flagged as suspicious/incomplete forever and repeatedly retried against the API, wasting the free-tier request budget.

**Why it happens:**
DST and holiday calendars are exactly the kind of "boring" detail that's easy to defer, but gap-detection/incremental-fetch code (Pitfall 8) depends on knowing what a "complete" trading calendar looks like — without it, the cache can't distinguish "legitimately no data" from "we're missing data and should re-fetch."

**How to avoid:**
- Use a proper IANA-timezone-aware library (not fixed offsets) so DST is handled automatically.
- Maintain (or fetch once and cache) a US market holiday/early-close calendar; treat weekends and holidays as expected non-trading periods, not gaps, in the gap-detection algorithm.
- For crypto (24/7, no holidays), gap-detection logic must be a genuinely separate code path from equities — reusing the equity trading-calendar logic for crypto will incorrectly treat real 24/7 data as having no gaps to check, or apply a Mon-Fri calendar to a market that trades every day.

**Warning signs:**
- Gap-fill logic repeatedly attempts to re-fetch the same holiday date every time the app starts.
- Charts show an unexpected flat/missing segment around a DST changeover weekend.

**Phase to address:** Caching/incremental-fetch phase, alongside gap-detection design.

---

### Pitfall 7: Indicator values don't match TradingView because of silent seeding/smoothing-method differences

**What goes wrong:**
This is the single most common "why doesn't my chart match TradingView" complaint in this domain, and it comes from several distinct, easily-conflated mistakes:

1. **RSI using a plain SMA of gains/losses instead of Wilder's smoothing.** TradingView's built-in RSI uses Wilder's smoothing exclusively (an exponential method with smoothing constant α = 1/length, i.e., `avgGain = (prevAvgGain × (length-1) + currentGain) / length`), seeded by a simple average of the first `length` periods. A naive RSI implementation using a rolling simple average throughout (not just for the seed) will diverge from TradingView, especially visible in extended trends.
2. **EMA seeding method.** TradingView (and most platforms) seed an EMA either from the first available price or from an SMA warm-up period, then apply the standard EMA recursion (α = 2/(length+1)) from there. If your EMA is seeded differently (e.g., starting at 0, or starting the recursion one bar off), values diverge for the first N bars and — because EMA is an infinite-impulse-response filter — the divergence decays but never fully disappears if the amount of historical lookback loaded differs from what TradingView loaded.
3. **MACD signal line formula.** The signal line must be a 9-period **EMA** of the MACD line (fast EMA − slow EMA), not an SMA. Getting this backwards (or offering it as a user toggle without matching TradingView's default) is a very common cause of "MACD looks totally different."
4. **Bollinger Band standard deviation divisor.** TradingView's default Bollinger Bands use **population standard deviation** (divide sum-of-squared-deviations by N, matching John Bollinger's original 1980s formula), not sample stddev (N-1). Using the sample-stddev formula (as many stats libraries default to, e.g., a language's built-in `stdev` vs `pstdev`) produces slightly *wider* bands than TradingView at the same period/multiplier — small in magnitude but a visible, permanent mismatch.
5. **Off-by-one on window definition.** Whether a "20-period MA" includes the current bar or the prior 20 closes excluding the current one, and whether the first N-1 bars of any windowed indicator should render "no value" (not zero, not a flat line) is a frequent source of subtle chart-start artifacts.

**Why it happens:**
Most of these indicators have multiple "textbook" formula variants that are all individually reasonable and produce plausible-looking output, so a naive from-scratch implementation (or picking the first Stack Overflow snippet or npm indicator package found) will compile and "look like an RSI/MACD/BB" without matching TradingView's specific convention — the bug is invisible unless you deliberately diff against a known-good reference.

**How to avoid:**
- Implement indicators against a written spec of TradingView's exact conventions (Wilder's smoothing for RSI with SMA-seeded warm-up; EMA with standard α=2/(n+1) for MACD/MA overlays and MACD signal line; population stdev for Bollinger Bands) rather than "an RSI" or "a Bollinger Band" in the abstract.
- Write correctness tests that compare computed indicator values against a small set of known reference values (e.g., manually verify against TradingView's own chart for a fixed historical symbol/date range, or against a trusted reference implementation like `talib`/`pandas-ta` configured to match Wilder's convention) — this is the only reliable way to catch a subtly-wrong-but-plausible formula.
- Since the project explicitly wants a pluggable indicator system, define the indicator interface so each indicator's "warm-up" behavior (how many leading bars produce no value) and smoothing convention are explicit, documented properties of the indicator — not implicit in the math — so future custom indicators don't inherit ambiguity.
- Decide explicitly and once: does the "moving average" indicator in the toggle list mean SMA, EMA, or user-selectable? Document the default to match TradingView's default for that indicator type.

**Warning signs:**
- Indicator values are "close but not exactly" TradingView's — this is the signature symptom, not a crash. Never treat "looks about right" as validated for indicator math.
- Bollinger Bands are consistently a bit wider than TradingView's at identical settings → sample vs population stdev.
- RSI is smoother/laggier or choppier than TradingView's at the same length → Wilder's vs SMA/EMA on gains-losses.
- MACD signal line disagrees more the further back in history you scroll → EMA seeding/lookback-depth mismatch.

**Phase to address:** Indicator system phase — this needs a dedicated verification step (compare against reference values) before indicators are considered "done," not just visual eyeballing.

---

### Pitfall 8: Incremental cache fetch/gap logic creates duplicate, overlapping, or stale bars

**What goes wrong:**
"Fetch once and cache forever" (the project's explicit design goal) is deceptively hard to get right incrementally. Common failure modes: (a) re-fetching a symbol's full history every time because the "do we have this range cached" check is naive (e.g., checking only min/max date without checking for interior gaps), wasting the free-tier request budget; (b) fetching an overlapping range and inserting duplicate bars with slightly different values (if FMP's EOD data for "today" gets revised intraday before market close, or a bar was fetched mid-candle for the still-forming current period), corrupting aggregates and indicator calculations that assume one row per timestamp; (c) never invalidating a stale "today's incomplete candle" that was cached before market close, so it's frozen forever as a wrong final close.

**Why it happens:**
Incremental caching is naturally modeled as "append new data since last fetch," which works for a simple append-only log but breaks down the moment there's revision (the most recent bar, whether daily or intraday, is provisional until the period closes) or a genuine hole in coverage (app wasn't run for a while, a fetch failed silently, symbol was added mid-history).

**How to avoid:**
- Use `(symbol, assetClass, timeframe, timestamp)` as a unique key (primary key or unique constraint) in local storage so re-fetching an already-cached bar is an idempotent upsert, never a duplicate insert.
- Explicitly track and re-fetch the "current, still-forming" bar for the active timeframe on each refresh (e.g., today's daily candle, or the current 1h candle) rather than treating it as immutable once cached — mark it distinctly (e.g., `isProvisional: true`) until the period fully closes, then finalize it.
- Implement gap detection as "walk the expected trading calendar (Pitfall 6) between min and max cached timestamp and find missing expected bars," not just "check if min/max range looks plausible" — this catches interior holes from failed fetches or app downtime.
- On a detected gap, fetch only the missing sub-range (using FMP's from/to date params), not the whole history, to conserve request budget.
- Decide a revision-tolerance policy: if a re-fetched bar for an already-finalized (non-provisional) period differs from the cached value (rare, but happens with corporate-action back-adjustment - see Pitfall 3), overwrite and log it rather than silently ignoring the discrepancy or silently keeping duplicate rows.

**Warning signs:**
- Cache size grows faster than expected relative to symbols × timeframes × trading days.
- Indicator values near "today" flicker/change on every refresh in a way that historical bars don't.
- The same request keeps re-fetching a date range that should already be cached.

**Phase to address:** Caching/persistence phase — this is core to the project's stated primary goal ("avoid re-fetching data"), so it deserves its own explicit design and test pass, not an incidental side effect of "call fetch, then save the response."

---

### Pitfall 9: Storing the FMP API key (and requests) in the renderer process without isolation

**What goes wrong:**
If the Electron (or Tauri) app makes API calls directly from renderer-process JavaScript with the API key embedded in that code/config, and the app is later distributed to a few users, the key becomes exposed to anything that can inspect the renderer (DevTools, injected scripts if a CSP is missing, a compromised dependency). Given each user configures their *own* FMP key, a key-leak bug primarily hurts that individual user's account (rate-limit/billing exposure), but it also means the app can't safely add future features like fetching or displaying arbitrary remote content without risking the key.

**Why it happens:**
It's simpler to `fetch()` directly from a React component than to set up an IPC bridge, especially for a small personal-use project, and Electron's insecure defaults from years past (nodeIntegration: true, no contextIsolation) are still what a lot of older tutorials show.

**How to avoid:**
- Keep `contextIsolation: true` and `nodeIntegration: false` (Electron's default since v20 — verify explicitly rather than relying on "it's probably fine").
- Store the API key only in the main process (e.g., in an OS-appropriate app-data location, potentially via `keytar`/OS credential store, or a local config file with restrictive permissions — acceptable for this single-user/small-group distribution scale) and perform all FMP HTTP requests from the main process.
- Expose a narrow, purpose-specific IPC API via `contextBridge.exposeInMainWorld` (e.g., `window.marketData.getCandles(...)`) — never expose a generic "make any HTTP request" or the raw key to the renderer.
- Apply a Content-Security-Policy that disallows loading remote scripts, and don't load any remote (non-packaged) content into the renderer.
- If Tauri is chosen instead (per the project's "decide in research phase" note), the equivalent pattern applies: keep the API key and outbound HTTP calls in the Rust backend, exposed to the frontend via Tauri commands, not via a JS-accessible store.

**Warning signs:**
- Any `fetch("https://financialmodelingprep.com/...")` call inside a React component or renderer-side module.
- The API key appearing in a value passed through `window`, `localStorage`, or a Redux/Zustand store accessible from DevTools console.

**Phase to address:** App-shell/foundation phase (Electron vs Tauri decision + IPC architecture) — must be decided before the data-fetching layer is wired into the UI, since retrofitting IPC boundaries after direct-fetch code is already spread through components is a larger refactor.

---

### Pitfall 10: Chart/indicator rendering performance degrades with many bars and multiple simultaneous charts

**What goes wrong:**
With multiple chart panes open (multi-layout requirement) each showing potentially thousands of bars plus several overlaid indicators (MA, BB, volume, RSI/MACD in sub-panes), naive re-render patterns cause visible jank: recomputing all indicator series from scratch on every pan/zoom/data update, or calling a full `setData()` (which replaces the whole series) on every incremental cache update instead of an incremental `update()` call for just the latest bar.

**Why it happens:**
It's easy to wire "new data arrived → replace the whole dataset" without distinguishing "one new/updated bar" from "a full re-fetch of history," especially once indicators are layered on top and need recomputation triggers of their own.

**How to avoid:**
- Use a canvas-based charting library built for this domain (e.g., `lightweight-charts`, the library TradingView itself publishes) rather than a general-purpose SVG/DOM charting library — canvas rendering avoids per-bar DOM node overhead and comfortably handles tens of thousands of candles.
- Distinguish "append/update latest bar" from "full dataset replace" in the data layer, and call the charting library's incremental update API for the former — never call the equivalent of `setData()` on every tick/refresh once the initial load is done.
- Compute indicator series incrementally where the underlying math supports it (e.g., EMA/RSI/MACD only need the previous state + the new bar to extend by one point) rather than recomputing the full series from the beginning of history on every update.
- For multiple simultaneous chart panes, each pane's data/indicator computation and rendering should be independent (no shared re-render trigger across unrelated charts) so panning one chart doesn't force recomputation in all others.
- If very long history (multi-year daily, or dense intraday) is loaded per chart, consider the charting library's built-in large-dataset optimizations (e.g., `lightweight-charts`' data conflation for zoomed-out views) rather than manually downsampling.

**Warning signs:**
- Visible frame drops/jank when panning or resizing with 2+ chart panes open.
- CPU usage spikes on every cache refresh even when only the latest bar changed.

**Phase to address:** Charting foundation phase (library selection + rendering architecture) and revisited in the multi-chart/layout phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|--------------------|-----------------|------------------|
| Fetch directly from renderer, skip IPC boundary | Faster initial prototyping | API key exposure, harder refactor later, blocks Tauri/Electron portability | Never for the distributed build — acceptable only in a throwaway local-only spike explicitly discarded before distribution |
| Hardcode "adjusted" endpoint everywhere without a schema discriminator | One less design decision early | Silent corruption on the next stock split; expensive retrofitted migration | Acceptable only if explicitly documented as the single, permanent convention (still needs the schema field for crypto's "n/a" case) |
| Use a naive RSI/EMA/BB implementation copied from a generic tutorial | Ships an indicator quickly | Values silently disagree with TradingView, undermining the whole point of the app ("mirror TradingView, minus the limits") | Never — verify against reference values before considering an indicator "done" |
| Full `setData()` refresh instead of incremental `update()` | Simpler initial implementation | Performance degrades once bar counts/chart counts grow; may need a larger refactor of the data→render pipeline | Acceptable temporarily for the first single-chart prototype, not once multi-chart/layouts ship |
| Skip market-holiday calendar, treat every missing weekday as a gap | Saves initial implementation time | Wastes free-tier request budget re-fetching holidays forever; false "gap" noise | Never beyond an early throwaway prototype |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|------------------|--------------------|
| FMP intraday endpoints | Assume 1m/5m/15m/1h always available | Runtime-probe capability per API key; degrade UI gracefully; re-probe after key changes |
| FMP adjusted vs unadjusted | Mix both endpoints across time without a discriminator | Standardize on adjusted for equities, tag every cached row with an explicit adjustment field, re-fetch full history on detected split |
| FMP crypto symbols | Reuse the equity URL/endpoint builder blindly for crypto tickers | Route by explicit `assetClass` field to asset-class-specific endpoint builders |
| FMP rate limits | Fire unthrottled parallel requests during backfill | Central request budget/rate limiter in the data layer; prioritize visible-range fetches over background backfill |
| FMP "today's" bar | Cache it as final/immutable | Mark as provisional; re-fetch/finalize once the period closes |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Full `setData()` on every refresh | Frame drops/jank on data refresh | Use incremental `update()` for latest bar; full `setData()` only on true history reload | Noticeable once a chart holds >~5k bars or 2+ charts are open simultaneously |
| Recomputing full indicator history on each tick | CPU spikes, UI stutter while panning | Incremental indicator computation (state + new bar) | Noticeable with multiple indicators × multiple panes |
| Unbounded local cache growth (every timeframe × every symbol × full history, forever) | Disk usage climbs; slow local DB queries over time | Prune/aggregate very old intraday data if not needed at full resolution long-term (daily/weekly data is cheap to keep in full); index by (symbol, timeframe, timestamp) | Noticeable after months of daily use across many symbols/timeframes, especially with 1m data retained indefinitely |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| API key embedded in renderer-accessible code/store | Key exfiltration via DevTools/injected script; abuse of that user's FMP account/quota | Keep key + HTTP calls in main process (or Tauri backend); expose only narrow IPC methods via `contextBridge` |
| `nodeIntegration: true` / missing `contextIsolation` | Renderer can read arbitrary local files (including any config holding the key) if compromised | Verify `contextIsolation: true`, `nodeIntegration: false` explicitly (don't just rely on version defaults) |
| No CSP / loading remote content in the renderer | Script injection reads local storage / IPC-exposed data | Strict CSP disallowing remote script sources; only load packaged local files |
| Storing API key in plaintext localStorage | Any renderer-side bug or malicious dependency can read it directly | Store in main-process-only config/OS credential store, not `localStorage`/renderer state |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Silent empty chart when free-tier plan restriction blocks intraday data | User thinks the symbol/timeframe has no data, or the app is broken | Distinct "requires higher FMP plan" message per timeframe/endpoint class |
| Crosshair/axis times shown in local machine timezone instead of exchange time | Times don't match what user expects from TradingView; confusing during market-hours reasoning | Default to exchange-session timezone display, matching TradingView convention |
| Indicator values silently differ from TradingView's | Erodes trust in the whole app ("is my chart lying to me?") | Verify indicator math against reference values before shipping each indicator |
| Rate-limit exhaustion with no visible explanation | User thinks the app crashed/broke | Visible request-budget indicator + explicit "rate limited, retrying at X" state |

## "Looks Done But Isn't" Checklist

- [ ] **Intraday timeframes:** Often "work" only because the dev's current FMP plan happens to allow them — verify the free-tier degraded path (disabled/labeled UI) is actually implemented and tested, not just the happy path.
- [ ] **Indicator calculations:** Often visually plausible but numerically wrong — verify each indicator (RSI, MACD, BB, MA) against known TradingView reference values for a fixed symbol/date range, not just "it looks like a wiggly line in the right place."
- [ ] **Caching "avoid re-fetch":** Often only handles the append-only case — verify gap-detection actually fills interior holes (e.g., simulate the app being offline for a week) and that today's provisional bar gets finalized correctly.
- [ ] **Timezone handling:** Often correct by accident during initial testing (if dev and market timezones happen to overlap in work hours) — verify explicitly across a DST transition date and for a non-US-Eastern dev machine timezone.
- [ ] **API key security:** Often "fine for now" because it's a solo/small-group personal app — verify the key never touches renderer-accessible storage/DevTools-visible state before distributing to other users.
- [ ] **Multi-chart layouts:** Often tested with only 1-2 panes during development — verify performance and independent-rerender behavior with the realistic max number of panes/indicators a user would actually open.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|-----------------|-------------------|
| Adjusted/unadjusted data mixed in cache | MEDIUM | Add the `adjustment` discriminator column; identify and re-fetch affected symbols from the correct endpoint; backfill full history for those symbols |
| Wrong indicator formula shipped (e.g., SMA-based RSI instead of Wilder's) | LOW-MEDIUM | Indicators are typically computed on read/render from cached raw OHLCV, not stored pre-computed — fixing the formula and re-rendering is usually enough; only costly if computed values were persisted and depended on elsewhere |
| Timezone bucketing bug in cached daily/weekly bars | MEDIUM-HIGH | Requires re-deriving daily/weekly aggregates from raw intraday/UTC-stored data if raw timestamps were preserved; HIGH cost if only the (already wrongly bucketed) daily bars were stored and originals discarded — argues for always retaining true UTC timestamps at storage time |
| API key leaked via renderer/DevTools | LOW (mitigation) / MEDIUM (user impact) | Rotate the affected user's FMP key immediately; patch the IPC boundary; no further action needed since keys are per-user, not shared infra |
| Rate-limit exhaustion mid-session | LOW | Wait for daily reset; in the meantime, prioritize serving fully from cache and disable background prefetch |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|--------------------|----------------|
| Free-tier vs paid endpoint availability assumptions | Data-layer / FMP provider integration | Toggle timeframe availability manually (simulate both plan tiers) and confirm UI degrades/upgrades correctly without code changes |
| Free-tier rate-limit exhaustion | Data-layer / FMP provider integration | Simulate a full watchlist backfill against a request budget counter; confirm it throttles/queues instead of failing |
| Adjusted vs unadjusted price mixing | Caching schema design | Schema review: every cached bar row has an explicit adjustment/assetClass field; test a simulated stock split re-fetch |
| Crypto vs equity symbol/endpoint handling | Data-source abstraction design | Unit test: crypto symbol routes to crypto endpoint builder; equity routes to equity builder; no shared blind string interpolation |
| Timezone/session bucketing correctness | Data-layer / candle normalization (charting foundation) | Test daily/weekly bucketing across a DST transition date and for a symbol in a different exchange timezone than the dev machine |
| DST/holiday gap-detection correctness | Caching/incremental-fetch design | Test gap-detection against a known holiday date and a known DST-transition week; confirm no spurious re-fetch |
| Indicator math matching TradingView | Indicator system phase | Reference-value test suite per indicator (RSI, MACD, BB, MA) against manually verified TradingView values for a fixed symbol/date range |
| Incremental cache correctness (dedupe, provisional bars, gap-fill) | Caching/persistence phase | Test: re-run fetch for an already-cached range (no duplicates), simulate offline gap (backfills correctly), verify today's bar updates until close then finalizes |
| API key exposure via renderer | App-shell/foundation (Electron/Tauri + IPC architecture) | Code review: no `fetch(...financialmodelingprep...)` call outside the main process/backend; DevTools inspection shows no raw key in renderer state |
| Chart/indicator render performance at scale | Charting foundation + multi-chart/layout phase | Manual test with realistic max chart-pane count and full indicator set open; profile for frame drops on pan/zoom |

## Sources

- [FMP Pricing Plans](https://site.financialmodelingprep.com/pricing-plans)
- [FMP FAQs](https://site.financialmodelingprep.com/faqs)
- [FMP Pricing docs](https://site.financialmodelingprep.com/developer/docs/pricing)
- [FMP GitHub API overview](https://github.com/FinancialModelingPrepAPI/Financial-Modeling-Prep-API)
- [FMP: Choosing the right plan](https://site.financialmodelingprep.com/insights/platform/how-to-choose-the-right-financial-modeling-prep-plan-for-your-workflow)
- [FMP Dividend-Adjusted Price Chart API](https://site.financialmodelingprep.com/developer/docs/stable/historical-price-eod-dividend-adjusted)
- [FMP Unadjusted Stock Price API](https://site.financialmodelingprep.com/developer/docs/stable/historical-price-eod-non-split-adjusted)
- [FMP: Comparing adjusted vs unadjusted prices](https://site.financialmodelingprep.com/how-to/how-to-compare-adjusted-vs-unadjusted-stock-prices-with-a-free-api)
- [FMP BTCUSD historical data](https://site.financialmodelingprep.com/historical-data-crypto/BTCUSD)
- [FMP Full Historical Cryptocurrency Data API](https://site.financialmodelingprep.com/developer/docs/stable/cryptocurrency-historical-price-eod-full)
- [Wilder's smoothing explainer — RSI Monitor](https://rsimonitor.com/articles/wilder-smoothing)
- [RSI — Wikipedia](https://en.wikipedia.org/wiki/Relative_strength_index)
- [RSI — StockCharts ChartSchool](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi)
- [MACD EMA seeding discussion](https://www.leewenmarketstats.com/post/macd_study_part_1)
- [ta-lib cross-platform indicator mismatch issue](https://github.com/mrjbq7/ta-lib/issues/469)
- [TradingView Bollinger Bands documentation/support](https://www.tradingview.com/support/solutions/43000501840-bollinger-bands-bb/)
- [Bollinger Bands population vs sample stdev — QuestDB cookbook](https://questdb.com/docs/cookbook/sql/finance/bollinger-bands/)
- [Electron Security tutorial (official)](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron security.md (GitHub source)](https://github.com/electron/electron/blob/main/docs/tutorial/security.md)
- [lightweight-charts (TradingView) GitHub](https://github.com/tradingview/lightweight-charts)
- [lightweight-charts docs](https://tradingview.github.io/lightweight-charts/docs)

---
*Pitfalls research for: personal desktop charting app (FMP-backed, TradingView-alternative, TypeScript/React)*
*Researched: 2026-07-18*
