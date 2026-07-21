# Toolbar & Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adjust the header toolbar (reorder, company-name search, progressive results) and restructure the Settings dialog into a registry-driven container with a theme toggle, gear trigger, and a masked saved-API-key preview.

**Architecture:** Backend/pure changes first (FMP dual-endpoint search, theme persistence in `settings.json`, key masking in `keystore`), then renderer UI (toolbar reorder, progressive result reveal, theme apply, and the registry-driven `SettingsDialog` split into self-contained `ThemeSetting` / `ApiKeySetting` items). Settings items are looked up from a declarative `SECTIONS`/`ITEMS` registry so adding a category or moving an item is a one-line data change.

**Tech Stack:** Electron + TypeScript + React, Vite ^7, TanStack Query, Radix UI dialog, lucide-react icons, Tailwind (HSL CSS vars), zod, electron `safeStorage`, vitest (node env).

## Global Constraints

- **Pin Vite at `^7`** — do not upgrade Vite.
- **Saving API calls is the top priority** — progressive result reveal must be client-side only; no extra network per scroll. Company-name search adds exactly one extra endpoint per unique query, absorbed by the existing `searchCache`.
- **Data source is abstracted** — all FMP changes stay inside `src/main/providers/FmpProvider.ts`.
- **D-05: never write plaintext API key** when encryption is unavailable — keystore already enforces this; don't regress it.
- **SQLite = OHLCV cache / JSON = user preferences** — theme goes in `settings.json`, not SQLite.
- **Test harness is vitest in node env** (`vitest.config`: `environment: 'node'`, `include: ['tests/**/*.test.ts']`). There is NO React DOM / jsdom setup. Only pure logic gets a vitest test; component-rendering behavior is verified by `npm run typecheck` and manual smoke. Tests live under `tests/` mirroring `src/`.
- **Verification commands:** `npm run typecheck` (both tsconfigs) and `npm test` (vitest run) must pass before each commit.

---

### Task 1: Reorder toolbar — move reload button into the right group

Move the `RefreshCw` reload button so the header right group reads `[更新] [SearchBar] [Settings]`. Pure JSX relocation; behavior (`handleReload`, `reloading` spinner, tooltip) unchanged. UI-only — verified by typecheck, no vitest test (harness can't render).

**Files:**
- Modify: `src/renderer/App.tsx:156-175`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Cut the reload Tooltip block out of the left group**

In `src/renderer/App.tsx`, delete this block currently sitting between the sidebar-toggle Tooltip and `<GridShapeRow />` (lines ~156-169):

```tsx
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleReload}
                disabled={reloading}
                aria-label="Reload visible charts"
              >
                <RefreshCw className={cn('size-4', reloading && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reload visible charts</TooltipContent>
          </Tooltip>
```

After deletion, the left group is: sidebar-toggle Tooltip, then `<GridShapeRow />`, then `<LayoutMenu />`.

- [ ] **Step 2: Paste it into the `ml-auto` right group before `<SearchBar />`**

Replace the right-group `<div>` (was lines ~172-175) with:

```tsx
          <div className="ml-auto flex items-center gap-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleReload}
                  disabled={reloading}
                  aria-label="Reload visible charts"
                >
                  <RefreshCw className={cn('size-4', reloading && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reload visible charts</TooltipContent>
            </Tooltip>
            <SearchBar />
            <SettingsDialog />
          </div>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no unused-import warnings; `RefreshCw`, `cn` still used).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(toolbar): move reload button next to search box"
```

---

### Task 2: Company-name search via dual FMP endpoints

`searchSymbols` currently calls only `search-symbol` (ticker match). Add `search-name` (company name) in parallel, merge and dedup by `symbol` with search-symbol winning ties, and bump `limit` 8 → 50 on both. Resilient: if one endpoint fails, return the other's results; throw only if both fail.

**Files:**
- Modify: `src/main/providers/FmpProvider.ts:84-93`
- Test: `tests/main/providers/FmpProvider.test.ts`

**Interfaces:**
- Consumes: existing `fmpSearchResponse` (zod), `SymbolResult` type, `this.httpGetJson`.
- Produces: `searchSymbols(query: string): Promise<SymbolResult[]>` — same signature, now merged/deduped from two endpoints, up to ~100 rows.

- [ ] **Step 1: Write the failing tests**

Add to the `describe('FmpProvider.searchSymbols', ...)` block in `tests/main/providers/FmpProvider.test.ts`:

```ts
  it('queries both search-symbol and search-name, merging and deduping by symbol', async () => {
    const httpGetJson = vi.fn(async (url: string) => {
      if (url.includes('search-symbol')) return [{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }]
      if (url.includes('search-name')) return [
        { symbol: 'AAPL', name: 'Apple Inc. (dup)', exchange: 'NASDAQ' }, // dup — search-symbol wins
        { symbol: 'APLE', name: 'Apple Hospitality REIT', exchange: 'NYSE' }
      ]
      throw new Error(`unexpected url ${url}`)
    })
    const results = await new FmpProvider({ apiKey: 'k', httpGetJson }).searchSymbols('apple')
    expect(httpGetJson).toHaveBeenCalledTimes(2)
    expect(httpGetJson.mock.calls.some((c) => c[0].includes('search-symbol'))).toBe(true)
    expect(httpGetJson.mock.calls.some((c) => c[0].includes('search-name'))).toBe(true)
    expect(results.map((r) => r.symbol)).toEqual(['AAPL', 'APLE'])
    expect(results[0].name).toBe('Apple Inc.') // search-symbol wins the dup
  })

  it('requests limit=50 on both endpoints', async () => {
    const httpGetJson = vi.fn(async (_url: string) => [])
    await new FmpProvider({ apiKey: 'k', httpGetJson }).searchSymbols('x')
    expect(httpGetJson.mock.calls.every((c) => c[0].includes('limit=50'))).toBe(true)
  })

  it('returns the surviving endpoint results when the other fails', async () => {
    const httpGetJson = vi.fn(async (url: string) => {
      if (url.includes('search-symbol')) throw new Error('rate limited')
      return [{ symbol: 'APLE', name: 'Apple Hospitality REIT', exchange: 'NYSE' }]
    })
    const results = await new FmpProvider({ apiKey: 'k', httpGetJson }).searchSymbols('apple')
    expect(results.map((r) => r.symbol)).toEqual(['APLE'])
  })

  it('throws only when both endpoints fail', async () => {
    const httpGetJson = vi.fn(async (_url: string) => { throw new Error('down') })
    await expect(new FmpProvider({ apiKey: 'k', httpGetJson }).searchSymbols('apple')).rejects.toThrow()
  })
```

The existing test `'maps search results to SymbolResult, preferring the exchange short code'` uses `provider(fx('fmp-search.json'))` whose `httpGetJson` returns the fixture for ANY url — it still passes because both endpoints return the same 2 rows and dedup collapses them to 2. Leave it as-is.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- FmpProvider`
Expected: the 4 new tests FAIL (only one endpoint called / `limit=8` / no resilience).

- [ ] **Step 3: Implement dual-endpoint merge**

Replace `searchSymbols` (lines 84-93) in `src/main/providers/FmpProvider.ts`:

```ts
  async searchSymbols(query: string): Promise<SymbolResult[]> {
    const q = encodeURIComponent(query)
    const fetchEndpoint = async (endpoint: 'search-symbol' | 'search-name'): Promise<SymbolResult[]> => {
      const url = `${BASE}/${endpoint}?query=${q}&limit=50&apikey=${this.apiKey}`
      // zod .parse throws on error-shaped payloads → never surfaces bad data
      const rows = fmpSearchResponse.parse(await this.httpGetJson(url))
      return rows.map((r) => ({
        symbol: r.symbol,
        name: r.name ?? r.symbol,
        exchange: r.exchange ?? r.exchangeFullName ?? ''
      }))
    }

    // search-symbol (ticker) first so exact-ticker matches sort above name matches; dedup by symbol
    // with the earlier (search-symbol) entry winning. Tolerate one endpoint failing (rate-limit etc).
    const [bySymbol, byName] = await Promise.allSettled([
      fetchEndpoint('search-symbol'),
      fetchEndpoint('search-name')
    ])
    if (bySymbol.status === 'rejected' && byName.status === 'rejected') throw bySymbol.reason

    const seen = new Set<string>()
    const merged: SymbolResult[] = []
    for (const settled of [bySymbol, byName]) {
      if (settled.status !== 'fulfilled') continue
      for (const r of settled.value) {
        if (seen.has(r.symbol)) continue
        seen.add(r.symbol)
        merged.push(r)
      }
    }
    return merged
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- FmpProvider`
Expected: all `searchSymbols` tests PASS (including the pre-existing one).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/providers/FmpProvider.ts tests/main/providers/FmpProvider.test.ts
git commit -m "feat(search): match company names via search-name endpoint"
```

---

### Task 3: Progressive search results (scroll to reveal more)

`SearchResults` hard-slices `results.slice(0, 8)`. Change to a client-side `visibleCount` (initial 15, +15 when the list is scrolled near its bottom, capped at `results.length`). Resets to 15 when `results` changes. No extra network. UI-only — verified by typecheck, no vitest test.

**Files:**
- Modify: `src/renderer/components/SearchResults.tsx`

**Interfaces:**
- Consumes: `results: SymbolResult[] | undefined` prop (unchanged).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add React hooks import and the reveal state/handler**

In `src/renderer/components/SearchResults.tsx`, change the React import (line 1) from:

```tsx
import React from 'react'
```

to:

```tsx
import React, { useEffect, useRef, useState } from 'react'
```

Then, inside the `SearchResults` function, at the TOP of the function body — BEFORE the guard clauses (`if (loading)` etc.) — add the hooks. Hooks must run unconditionally on every render (React Rules of Hooks); placing them after the early `return`s would change the hook count between the loading and results renders and crash. Because `results` may be `undefined` at this point, the scroll cap uses `results?.length ?? c`:

```tsx
  const INITIAL = 15
  const STEP = 15
  const [visibleCount, setVisibleCount] = useState(INITIAL)
  const listRef = useRef<HTMLUListElement>(null)

  // Reset the reveal window whenever a new result set arrives (new search).
  useEffect(() => {
    setVisibleCount(INITIAL)
    if (listRef.current) listRef.current.scrollTop = 0
  }, [results])

  // Reveal +15 more when scrolled near the bottom. Capped at the fetched count — no extra network
  // (all rows already fetched into `results`). onScroll only fires from the rendered <ul>, where
  // results is defined, but `?? c` keeps the cap safe for the union type.
  const onScroll = (e: React.UIEvent<HTMLUListElement>): void => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) {
      setVisibleCount((c) => Math.min(c + STEP, results?.length ?? c))
    }
  }
```

Note: these hooks sit ABOVE the guard clauses so they run on every render regardless of loading/error/empty state.

- [ ] **Step 2: Wire the ref/handler onto the `<ul>` and use `visibleCount` in the slice**

Change the list opening tag from:

```tsx
    <ul className="max-h-[280px] overflow-y-auto rounded-md border border-border bg-card">
      {results.slice(0, 8).map((r) => {
```

to:

```tsx
    <ul ref={listRef} onScroll={onScroll} className="max-h-[280px] overflow-y-auto rounded-md border border-border bg-card">
      {results.slice(0, visibleCount).map((r) => {
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run: `npm run dev`, search a broad term (e.g. "apple"), scroll the results list to the bottom, confirm more rows appear (up to the fetched count) with no network activity per scroll.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SearchResults.tsx
git commit -m "feat(search): reveal more results on scroll (15 + 15)"
```

---

### Task 4: Theme persistence (settings.json + IPC + preload + api)

Add `getTheme`/`setTheme` to the JSON settings store and thread a new IPC channel through `shared/ipc`, `ipc.ts`, `preload/index.ts`, and `api.ts`. Value is `'light' | 'dark' | 'system'`, default `'system'`.

**Files:**
- Modify: `src/main/settings.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/api.ts`
- Test: `tests/main/settings.test.ts`

**Interfaces:**
- Produces:
  - `Theme = 'light' | 'dark' | 'system'` (exported from `src/shared/ipc.ts`).
  - `settings.getTheme(): Theme` (main) — defaults to `'system'`.
  - `settings.setTheme(t: Theme): void` (main).
  - `api.settings.getTheme(): Promise<Theme>` and `api.settings.setTheme(t: Theme): Promise<void>` (renderer) — consumed by Tasks 7 and 8.

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `tests/main/settings.test.ts`:

```ts
describe('settings theme', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'settings-test-'))
  })
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it("defaults to 'system' before anything is saved", () => {
    expect(settings.getTheme()).toBe('system')
  })

  it('round-trips a theme through set → get', () => {
    settings.setTheme('dark')
    expect(settings.getTheme()).toBe('dark')
  })

  it('does not clobber sidebarWidth when writing theme', () => {
    settings.setSidebarWidth(360)
    settings.setTheme('light')
    expect(settings.getSidebarWidth()).toBe(360)
    expect(settings.getTheme()).toBe('light')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- settings`
Expected: FAIL — `settings.getTheme is not a function`.

- [ ] **Step 3: Add `getTheme`/`setTheme` to `settings.ts`**

Append to `src/main/settings.ts`:

```ts
// Theme is a user preference (JSON, not SQLite). 'system' follows OS at startup (resolved in renderer).
export type Theme = 'light' | 'dark' | 'system'

export function getTheme(): Theme {
  const v = read().theme
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

export function setTheme(theme: Theme): void {
  writeJsonFile(settingsPath(), { ...read(), theme })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- settings`
Expected: PASS.

- [ ] **Step 5: Add the IPC channels and Api types to `shared/ipc.ts`**

In `src/shared/ipc.ts`, add to the `CH` object (after `settingsSetSidebarWidth`):

```ts
  settingsGetTheme: 'settings:getTheme',
  settingsSetTheme: 'settings:setTheme',
```

Add the exported type near `CapabilityStatus` (after line 31):

```ts
export type Theme = 'light' | 'dark' | 'system'
```

Add to the `Api['settings']` interface (after `setSidebarWidth`):

```ts
    getTheme(): Promise<Theme>
    setTheme(theme: Theme): Promise<void>
```

Add `Theme` to the import from `./types`? No — `Theme` is declared in `ipc.ts` itself, no import needed.

- [ ] **Step 6: Register the handlers in `ipc.ts`**

In `src/main/ipc.ts`, extend the import from `./settings` (line 9) to include the new functions:

```ts
import { getLastSymbol, setLastSymbol, getSidebarOpen, setSidebarOpen, getSidebarWidth, setSidebarWidth, getTheme, setTheme } from './settings'
```

Add two handlers after the `settingsSetSidebarWidth` handler (after line 125):

```ts
  ipcMain.handle(CH.settingsGetTheme, () => getTheme())
  ipcMain.handle(CH.settingsSetTheme, (_e, theme: import('./settings').Theme) => setTheme(theme))
```

- [ ] **Step 7: Expose them in the preload bridge**

In `src/preload/index.ts`, add to the `settings` object (after `setSidebarWidth`, line 27):

```ts
    getTheme: () => ipcRenderer.invoke(CH.settingsGetTheme),
    setTheme: (theme) => ipcRenderer.invoke(CH.settingsSetTheme, theme)
```

(The `Api` type from `@shared/ipc` already types the callback params, so no explicit annotation is needed.)

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: PASS. `src/renderer/api.ts` needs no change — it re-exports `window.api` whose type is `Api`, which now includes `getTheme`/`setTheme`.

- [ ] **Step 9: Commit**

```bash
git add src/main/settings.ts src/shared/ipc.ts src/main/ipc.ts src/preload/index.ts tests/main/settings.test.ts
git commit -m "feat(settings): persist theme preference (light/dark/system)"
```

---

### Task 5: Masked saved-API-key preview (keystore + status type)

Add a pure `maskKey` helper and expose an optional `maskedKey` on the API-key status. The mask shows the last 4 chars real, the rest as dots, with **total length equal to the actual key length**. When the key can't be decrypted (encryption unavailable / file unreadable), `maskedKey` is omitted.

**Files:**
- Modify: `src/main/keystore.ts`
- Modify: `src/shared/ipc.ts` (extend `KeyStatus`)
- Test: `tests/main/keystore.test.ts` (new)

**Interfaces:**
- Consumes: `getApiKey(): string | null` (existing).
- Produces:
  - `maskKey(key: string): string` (exported from `src/main/keystore.ts`) — `key.length > 4 ? '•'.repeat(key.length - 4) + key.slice(-4) : '•'.repeat(key.length)`.
  - `getKeyStatus(): { hasKey: boolean; encryptionAvailable: boolean; maskedKey?: string }`.
  - `KeyStatus` type in `shared/ipc.ts` gains `maskedKey?: string` — consumed by `ApiKeySetting` in Task 9.

- [ ] **Step 1: Write the failing test**

Create `tests/main/keystore.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { maskKey } from '../../src/main/keystore'

describe('maskKey', () => {
  it('shows the last 4 chars real, the rest as dots, total length == key length', () => {
    const masked = maskKey('ABCD1234WXYZ') // length 12
    expect(masked).toBe('••••••••WXYZ')
    expect(masked.length).toBe(12)
  })

  it('masks the whole thing when the key is 4 chars or shorter', () => {
    expect(maskKey('AB')).toBe('••')
    expect(maskKey('WXYZ')).toBe('••••')
  })
})
```

(`maskKey` is a pure string function — no `electron`/`safeStorage` mock needed, so this test avoids the native-binding surface entirely.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- keystore`
Expected: FAIL — `maskKey` not exported.

- [ ] **Step 3: Add `maskKey` and extend `getKeyStatus` in `keystore.ts`**

In `src/main/keystore.ts`, add the exported helper (e.g. after the imports / before `setApiKey`):

```ts
// Mask a saved key for display: last 4 chars real, rest dotted, total length == key length.
// (This intentionally leaks the key's length — accepted trade-off so the user can identify which
// key is set.)
export function maskKey(key: string): string {
  return key.length > 4 ? '•'.repeat(key.length - 4) + key.slice(-4) : '•'.repeat(key.length)
}
```

Replace `getKeyStatus` (lines 27-31) with:

```ts
export function getKeyStatus(): { hasKey: boolean; encryptionAvailable: boolean; maskedKey?: string } {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  const hasKey = cached !== null || existsSync(keyPath())
  // Only include a preview when we can actually read the key back. If it's saved but undecryptable
  // (encryption unavailable / unreadable file), omit maskedKey → UI falls back to "saved" only.
  const key = hasKey ? getApiKey() : null
  return key !== null ? { hasKey, encryptionAvailable, maskedKey: maskKey(key) } : { hasKey, encryptionAvailable }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- keystore`
Expected: PASS.

- [ ] **Step 5: Extend the `KeyStatus` type in `shared/ipc.ts`**

In `src/shared/ipc.ts`, change (line 29):

```ts
export type KeyStatus = { hasKey: boolean; encryptionAvailable: boolean }
```

to:

```ts
export type KeyStatus = { hasKey: boolean; encryptionAvailable: boolean; maskedKey?: string }
```

No change needed in `ipc.ts` (the `apikeyStatus` handler already returns `getKeyStatus()`), `preload/index.ts`, or `api.ts` — the type flows through `Api`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/keystore.ts src/shared/ipc.ts tests/main/keystore.test.ts
git commit -m "feat(settings): expose masked saved API key preview"
```

---

### Task 6: Split CSS palette into light (`:root`) and dark (`.dark`)

`index.css` currently gives `:root, .dark` the same dark values. Split them: `:root` = a new light palette, `.dark` = the current dark values. Accent `#2E7DE1` (primary/accent/ring) stays in both. CSS-only — no test; verified by manual smoke.

**Files:**
- Modify: `src/renderer/index.css`

**Interfaces:** none.

- [ ] **Step 1: Replace the combined selector with two separate blocks**

In `src/renderer/index.css`, replace the whole `:root, .dark { ... }` block (lines 5-29) with:

```css
/* Light palette (:root, default) and dark palette (.dark). Accent #2E7DE1 is shared.
   Dark values map to 01-UI-SPEC.md: #0B0E11 bg, #151920 card, #E4E7EB text, #8B92A0 muted, #E5484D destructive. */
:root {
  --background: 0 0% 100%;           /* white */
  --foreground: 210 24% 12%;         /* near-black slate text */
  --card: 210 20% 98%;               /* off-white card */
  --card-foreground: 210 24% 12%;
  --popover: 0 0% 100%;
  --popover-foreground: 210 24% 12%;
  --primary: 212 74% 53%;            /* #2E7DE1 accent = primary CTA (shared) */
  --primary-foreground: 0 0% 100%;
  --secondary: 210 20% 96%;
  --secondary-foreground: 210 24% 12%;
  --muted: 210 20% 94%;
  --muted-foreground: 216 11% 40%;
  --accent: 212 74% 53%;
  --accent-foreground: 0 0% 100%;
  --destructive: 358 76% 59%;        /* #E5484D (shared) */
  --destructive-foreground: 0 0% 100%;
  --border: 214 20% 85%;
  --input: 214 20% 85%;
  --ring: 212 74% 53%;               /* focus ring = accent */
  --radius: 0.5rem;
}

.dark {
  --background: 210 24% 6%;          /* #0B0E11 */
  --foreground: 213 15% 90%;         /* #E4E7EB */
  --card: 213 21% 10%;               /* #151920 */
  --card-foreground: 213 15% 90%;
  --popover: 213 21% 10%;
  --popover-foreground: 213 15% 90%;
  --primary: 212 74% 53%;            /* #2E7DE1 accent = primary CTA */
  --primary-foreground: 0 0% 100%;
  --secondary: 213 21% 10%;          /* #151920 */
  --secondary-foreground: 213 15% 90%;
  --muted: 213 21% 14%;
  --muted-foreground: 216 11% 59%;   /* #8B92A0 */
  --accent: 212 74% 53%;
  --accent-foreground: 0 0% 100%;
  --destructive: 358 76% 59%;        /* #E5484D */
  --destructive-foreground: 0 0% 100%;
  --border: 213 15% 20%;
  --input: 213 15% 20%;
  --ring: 212 74% 53%;               /* focus ring = accent */
  --radius: 0.5rem;
}
```

- [ ] **Step 2: Manual smoke**

Run: `npm run dev`. The app still renders dark **only if** `<html>` has the `.dark` class. Since Task 7 adds the startup apply, at this point the app will render **light** (no `.dark` yet) — that's expected. Confirm the light palette looks reasonable (white bg, dark text, blue accent). Dark is verified in Task 7.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.css
git commit -m "feat(theme): split CSS into light and dark palettes"
```

---

### Task 7: Apply theme on startup + `resolveDark` helper

At startup, read the saved theme and toggle `.dark` on `<html>`. `'system'` resolves via `matchMedia('(prefers-color-scheme: dark)')`. Extract the pure resolution into a testable helper.

**Files:**
- Create: `src/renderer/lib/theme.ts`
- Modify: `src/renderer/App.tsx` (startup effect)
- Test: `tests/renderer/theme.test.ts` (new)

**Interfaces:**
- Consumes: `api.settings.getTheme()` (Task 4), `Theme` type from `@shared/ipc`.
- Produces:
  - `resolveDark(theme: Theme, systemPrefersDark: boolean): boolean` — `theme === 'dark' || (theme === 'system' && systemPrefersDark)`.
  - `applyTheme(theme: Theme): void` — reads `matchMedia` and toggles `document.documentElement.classList` `.dark`. Consumed by Task 8 (`ThemeSetting`).

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/theme.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveDark } from '../../src/renderer/lib/theme'

describe('resolveDark', () => {
  it("'dark' is always dark regardless of system", () => {
    expect(resolveDark('dark', false)).toBe(true)
    expect(resolveDark('dark', true)).toBe(true)
  })
  it("'light' is always light regardless of system", () => {
    expect(resolveDark('light', true)).toBe(false)
    expect(resolveDark('light', false)).toBe(false)
  })
  it("'system' follows the system preference", () => {
    expect(resolveDark('system', true)).toBe(true)
    expect(resolveDark('system', false)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- theme`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/renderer/lib/theme.ts`**

```ts
import type { Theme } from '@shared/ipc'

// Pure resolution — testable without a DOM.
export function resolveDark(theme: Theme, systemPrefersDark: boolean): boolean {
  return theme === 'dark' || (theme === 'system' && systemPrefersDark)
}

// Toggle the .dark class on <html> for the given theme. 'system' resolves via matchMedia.
// ponytail: startup-resolve only — no live OS-change listener (spec §YAGNI); add a change
// listener if that's needed later.
export function applyTheme(theme: Theme): void {
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', resolveDark(theme, systemPrefersDark))
}
```

Note: `@shared` alias resolves in vitest (see `vitest.config` `resolve.alias`) and in the renderer build.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- theme`
Expected: PASS.

- [ ] **Step 5: Apply theme on startup in `App.tsx`**

In `src/renderer/App.tsx`, add the import near the other renderer imports (after line 17):

```tsx
import { applyTheme } from './lib/theme'
```

Inside the one-time startup restore effect (the `useEffect(() => { ... }, [])` at lines 31-43), add as its first statement, before `void api.layout.getCurrent()...`:

```tsx
    void api.settings.getTheme().then(applyTheme)
```

- [ ] **Step 6: Typecheck + manual smoke**

Run: `npm run typecheck` → PASS.
Run: `npm run dev` → with no saved theme, `'system'` applies; on a dark-mode OS the app is dark again, on a light-mode OS it's light. Confirm the dark palette renders (verifies Task 6's `.dark` block).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/lib/theme.ts src/renderer/App.tsx tests/renderer/theme.test.ts
git commit -m "feat(theme): apply saved theme on startup"
```

---

### Task 8: Extract `ThemeSetting` component

Create the self-contained Light/Dark/System toggle. On select it applies the theme immediately (`applyTheme`) and persists (`api.settings.setTheme`). Reads the current theme on mount to show the active selection. UI — verified by typecheck.

**Files:**
- Create: `src/renderer/components/settings/ThemeSetting.tsx`

**Interfaces:**
- Consumes: `applyTheme` (Task 7), `api.settings.getTheme/setTheme` (Task 4), `Theme` type.
- Produces: `<ThemeSetting />` (no props) — registered in Task 10's `ITEMS`.

- [ ] **Step 1: Create `ThemeSetting.tsx`**

```tsx
import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/api'
import { applyTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import type { Theme } from '@shared/ipc'

const OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

export function ThemeSetting(): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    void api.settings.getTheme().then(setTheme)
  }, [])

  const select = (t: Theme): void => {
    setTheme(t)
    applyTheme(t)
    void api.settings.setTheme(t)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium">Theme</div>
      <div className="flex gap-2">
        {OPTIONS.map((o) => (
          <Button
            key={o.value}
            variant={theme === o.value ? 'default' : 'secondary'}
            size="sm"
            onClick={() => select(o.value)}
            aria-pressed={theme === o.value}
            className={cn(theme === o.value && 'ring-1 ring-ring')}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (Component is not yet mounted anywhere — that happens in Task 10. Typecheck confirms imports/types resolve.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/ThemeSetting.tsx
git commit -m "feat(settings): extract ThemeSetting toggle component"
```

---

### Task 9: Extract `ApiKeySetting` component (with masked preview)

Move the current API-key input/save/remove/encryption-warning logic out of `SettingsDialog` into a self-contained component, and add the masked saved-key preview above the input. Reads status on mount, re-reads after save/clear. UI — verified by typecheck.

**Files:**
- Create: `src/renderer/components/settings/ApiKeySetting.tsx`

**Interfaces:**
- Consumes: `api.apikey.set/status/clear`, `KeyStatus` (now with `maskedKey?`, Task 5), `useQueryClient`.
- Produces: `<ApiKeySetting />` (no props) — registered in Task 10's `ITEMS`.

- [ ] **Step 1: Create `ApiKeySetting.tsx`**

This is the existing `SettingsDialog` key logic, self-contained, plus the masked preview. `status` type is `KeyStatus` from `@shared/ipc` (includes `maskedKey?`).

```tsx
import React, { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/api'
import type { KeyStatus } from '@shared/ipc'

export function ApiKeySetting(): React.JSX.Element {
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<KeyStatus | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    void api.apikey.status().then(setStatus)
  }, [])

  const save = async (): Promise<void> => {
    await api.apikey.set(key)
    setKey('')
    setStatus(await api.apikey.status())
    void queryClient.invalidateQueries({ queryKey: ['ohlcv'] })
    void queryClient.invalidateQueries({ queryKey: ['capabilities'] }) // SC4: paid key re-enables intraday, no code change
    void queryClient.invalidateQueries({ queryKey: ['profile'] }) // キー登録でヘッダー社名/取引所を再解決
  }

  const clear = async (): Promise<void> => {
    if (!confirm("Remove your saved FMP API key? You'll need to re-enter it to fetch new data. Already-cached charts keep working offline.")) return
    await api.apikey.clear()
    setStatus(await api.apikey.status())
    void queryClient.invalidateQueries({ queryKey: ['capabilities'] })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium">FMP API Key</div>
      {status && !status.encryptionAvailable && (
        <div role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm text-destructive">
          Your OS doesn't support secure credential storage. Your API key will be saved in plain text on this
          device — avoid using this app on a shared machine until this is resolved.
        </div>
      )}
      {status?.maskedKey && (
        <div className="text-xs text-muted-foreground">Saved: {status.maskedKey}</div>
      )}
      <Input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={status?.hasKey ? 'API key saved — enter a new key to replace' : 'Enter your FMP API key'}
      />
      <div className="flex gap-2">
        <Button onClick={save} disabled={key.length === 0}>Save API Key</Button>
        {status?.hasKey && (
          <Button variant="destructive" onClick={clear}>Remove API Key</Button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/settings/ApiKeySetting.tsx
git commit -m "feat(settings): extract ApiKeySetting with masked key preview"
```

---

### Task 10: Rebuild `SettingsDialog` as a registry-driven container with gear trigger

Replace `SettingsDialog`'s hand-written body with the declarative `SECTIONS`/`ITEMS` registry, a left-nav + right-pane layout, and a gear-icon trigger. It holds no per-setting logic (that now lives in `ThemeSetting`/`ApiKeySetting`).

**Files:**
- Modify (rewrite): `src/renderer/components/SettingsDialog.tsx`

**Interfaces:**
- Consumes: `<ThemeSetting />` (Task 8), `<ApiKeySetting />` (Task 9), Radix `Dialog*`, `Button`, `Tooltip*`, lucide `Settings` icon.
- Produces: `<SettingsDialog />` (no props) — already mounted in `App.tsx` (Task 1).

- [ ] **Step 1: Rewrite `SettingsDialog.tsx`**

Replace the entire file with:

```tsx
import React, { useState } from 'react'
import { Settings as SettingsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ThemeSetting } from './settings/ThemeSetting'
import { ApiKeySetting } from './settings/ApiKeySetting'

// Declarative registry. Add a category = one SECTIONS entry. Move an item between categories =
// change its `section` string. Order within a category = order in ITEMS. (spec: settings-dialog-structure)
const SECTIONS = [{ id: 'general', label: 'General' }] as const
type SectionId = (typeof SECTIONS)[number]['id']

const ITEMS: { id: string; section: SectionId; render: () => React.JSX.Element }[] = [
  { id: 'theme', section: 'general', render: () => <ThemeSetting /> },
  { id: 'apikey', section: 'general', render: () => <ApiKeySetting /> }
]

export function SettingsDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<SectionId>(SECTIONS[0].id)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Settings">
              <SettingsIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </DialogTrigger>
      <DialogContent className="max-w-2xl p-0">
        <div className="flex min-h-[360px]">
          <nav className="w-40 shrink-0 border-r border-border p-3">
            <DialogHeader className="mb-3 px-1">
              <DialogTitle>Settings</DialogTitle>
            </DialogHeader>
            <ul className="flex flex-col gap-1">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setActive(s.id)}
                    className={cn(
                      'w-full rounded-md px-2 py-1.5 text-left text-sm',
                      active === s.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                    )}
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex flex-1 flex-col gap-6 p-6">
            {ITEMS.filter((i) => i.section === active).map((i) => (
              <div key={i.id}>{i.render()}</div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

Notes:
- `DialogContent` gets `max-w-2xl p-0` (wider, padding moved onto the inner panes) so the left-nav + content sit side by side. If the base `DialogContent` in `@/components/ui/dialog` hard-codes a narrower `max-w-*`, `max-w-2xl` via `cn`/tailwind-merge overrides it (later class wins).
- Radix requires a `DialogTitle` for accessibility — it lives in the left nav header here.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Full test + manual smoke**

Run: `npm test` → all PASS.
Run: `npm run dev` and verify:
- Header right group order is `[reload] [search] [gear]`; gear shows a "Settings" tooltip.
- Clicking the gear opens a wide dialog with a "General" left-nav item and both Theme + API Key settings on the right.
- Theme buttons switch the app between light/dark immediately and the choice survives a restart.
- Saving an API key then reopening shows `Saved: ••••••••WXYZ` (dots + last 4) above the input.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/SettingsDialog.tsx
git commit -m "feat(settings): registry-driven dialog with left nav and gear trigger"
```

---

## Self-Review

**Spec coverage:**

Toolbar spec:
1. Reorder reload button → Task 1. ✓
2. Company-name search (dual endpoint, allSettled, dedup) → Task 2. ✓
3. Progressive results (limit=50 + visibleCount 15/+15) → limit in Task 2, reveal in Task 3. ✓
4. Theme: CSS split → Task 6; persistence → Task 4; apply → Task 7; 3-way toggle → Task 8; gear trigger → Task 10. ✓

Settings-dialog-structure spec:
- Left-nav + right-pane layout, wide DialogContent, gear trigger → Task 10. ✓
- Declarative `SECTIONS`/`ITEMS` registry → Task 10. ✓
- Component split (`ThemeSetting`, `ApiKeySetting`, container-only `SettingsDialog`) → Tasks 8, 9, 10. ✓
- Masked API key (`maskKey`, `getKeyStatus` maskedKey, `KeyStatus` type, `ApiKeySetting` preview) → Tasks 5, 9. ✓

**Type consistency:** `Theme` declared once in `shared/ipc.ts` (Task 4), imported by `theme.ts` (Task 7), `ThemeSetting` (Task 8), and `settings.ts` re-declares its own `Theme` (main-side, structurally identical — acceptable since main and renderer don't share the runtime value, only the string union). `KeyStatus` extended once (Task 5), consumed by `ApiKeySetting` (Task 9). `resolveDark`/`applyTheme`/`maskKey`/`getTheme`/`setTheme` signatures match across producer and consumer tasks.

**Note on the two `Theme` declarations:** `settings.ts` (main) and `shared/ipc.ts` both declare `export type Theme = 'light' | 'dark' | 'system'`. This mild duplication is deliberate — `shared/ipc.ts` must not import from `src/main` (renderer would pull in main-only code). Both are the same string union; if they ever drift, typecheck at the IPC boundary (`ipc.ts` casts the handler arg to `import('./settings').Theme`) catches it.

**Placeholder scan:** no TBD/TODO; every code step shows full code. ✓
