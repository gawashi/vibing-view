# Phase 1 — Core Pipeline Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can search a US stock or crypto symbol and see its daily candlestick chart, rendered from a locally cached, provider-abstracted FMP pipeline, with the API key held securely in the Electron main process and the app in a dark theme.

**Architecture:** Electron three-process split. The **main** process owns everything sensitive: FMP fetches (`FmpProvider` implementing `IDataProvider`), a `CacheService` that read-through-caches OHLCV into SQLite (drizzle + better-sqlite3), safeStorage-encrypted key storage, and a last-symbol JSON. The **preload** exposes a typed `window.api` over `ipcRenderer.invoke`; the key never crosses outbound. The **renderer** (React + lightweight-charts + Zustand + TanStack Query) sends queries over IPC and receives only results.

**Tech Stack:** Electron 43, electron-vite 5, Vite 7 (pinned — not 8), React 19, TypeScript 7, lightweight-charts 5.2, better-sqlite3 12, drizzle-orm 0.45, Zustand 5, TanStack Query 5, zod, Tailwind + shadcn/ui (zinc, dark-only), Vitest.

## Global Constraints

- **Vite pinned to `^7`** — electron-vite@5 does not declare Vite 8 support. Never let the lockfile drift to Vite 8.
- **`better-sqlite3` runs in main only** and must be rebuilt against Electron's ABI (electron-builder `install-app-deps` / `@electron/rebuild` postinstall). It is never imported in renderer or preload.
- **API key never leaves main outbound**: renderer sends it once via `apikey:set`; all other IPC returns results/booleans only. `apikey:status` returns `{hasKey, encryptionAvailable}` — never the key. FMP is called only in main.
- **safeStorage degrades safely (D-05)**: when `isEncryptionAvailable()` is false, surface `encryptionAvailable: false` so the UI shows the warning — never silently store plaintext without signalling.
- **Dark theme only (CHART-05)**: shadcn `zinc` preset, CSS variables, no light/dark toggle. Palette exact values from `01-UI-SPEC.md`.
- **Cache is authoritative (DATA-03)**: on a coverage hit, no FMP request is made. P1 fetches all daily history once (D-08) and records a `[oldest, newest]` coverage interval (D-09).
- **`IDataProvider` is the only data seam (DATA-02)**: FMP is the sole implementation; a second provider must be additive.
- **Bar time model**: UTC epoch **seconds** throughout (lightweight-charts native `UTCTimestamp`). FMP daily `date` ("YYYY-MM-DD") → `Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000)`.
- **Copy strings** come verbatim from `01-UI-SPEC.md` Copywriting Contract.
- **Testing split**: Vitest covers pure logic only (Node, no native modules). Native-bound layers (sqlite, safeStorage, IPC, chart) are verified via the running-app smoke check in the final task.

**Canonical references (read before implementing):** `.claude/CLAUDE.md`, `.planning/phases/01-core-pipeline-slice/01-CONTEXT.md`, `.planning/phases/01-core-pipeline-slice/01-UI-SPEC.md`, `docs/superpowers/specs/2026-07-19-phase1-technical-seams-design.md`.

## File Structure

```
package.json                         deps + scripts (Task 1)
electron.vite.config.ts              main/preload/renderer build (Task 1)
tsconfig.json / tsconfig.node.json / tsconfig.web.json   (Task 1)
vitest.config.ts                     (Task 1)
index.html                           renderer entry (Task 1)
tailwind.config.js / postcss.config.js  (Task 2)
components.json                      shadcn config (Task 2)
src/
  shared/
    types.ts                         Bar, SymbolResult, Timeframe, DateRange (Task 3)
    ipc.ts                           channel names + Api type (Task 7)
  main/
    index.ts                         window, app lifecycle, wiring (Task 1, 7, 11)
    db/
      schema.ts                      drizzle bars + coverage tables (Task 3)
      client.ts                      db open + CREATE TABLE IF NOT EXISTS (Task 3)
      barStore.ts                    typed reads/writes + coverageFromBars (Task 3)
    providers/
      IDataProvider.ts               interface (Task 4)
      fmp.schema.ts                  zod schemas (Task 4)
      FmpProvider.ts                 fetch + validate + map (Task 4)
    cache/CacheService.ts            read-through orchestration (Task 5)
    keystore.ts                      safeStorage encrypt/decrypt/status (Task 6)
    settings.ts                      last-symbol JSON (Task 6)
    searchCache.ts                   in-memory TTL cache (Task 6)
    ipc.ts                           ipcMain.handle registration (Task 7)
  preload/index.ts                   contextBridge window.api (Task 7)
  renderer/
    main.tsx                         React root + QueryClientProvider (Task 8)
    App.tsx                          layout shell (Task 1, 9, 10, 11)
    store.ts                         Zustand activeSymbol (Task 8)
    api.ts                           typed wrappers over window.api (Task 8)
    index.css                        Tailwind + dark tokens (Task 2)
    components/
      SearchBar.tsx                  (Task 9)
      SearchResults.tsx              (Task 9)
      SettingsDialog.tsx             (Task 9)
      Chart.tsx                      lightweight-charts (Task 10)
tests/
  fixtures/fmp-*.json                FMP sample payloads (Task 4)
  main/providers/FmpProvider.test.ts (Task 4)
  main/cache/CacheService.test.ts    (Task 5)
  main/searchCache.test.ts           (Task 6)
  main/db/coverageFromBars.test.ts   (Task 3)
```

---

### Task 1: Scaffold Electron + Vite + React + TS + Vitest

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`, `index.html`, `.gitignore`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/index.css`

**Interfaces:**
- Produces: `npm run dev` (launch), `npm run build` (compile), `npm test` (Vitest) scripts; a dark blank window.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "trading-view",
  "version": "0.1.0",
  "description": "Personal TradingView-alternative charting app",
  "main": "./out/main/index.js",
  "author": "gawashi",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "postinstall": "electron-builder install-app-deps"
  },
  "dependencies": {
    "better-sqlite3": "^12.0.0",
    "drizzle-orm": "^0.45.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@tanstack/react-query": "^5.101.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^4.3.0",
    "electron": "^43.0.0",
    "electron-builder": "^26.0.0",
    "electron-vite": "^5.0.0",
    "lightweight-charts": "^5.2.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "typescript": "^7.0.0",
    "vite": "^7.0.0",
    "vitest": "^3.0.0",
    "zustand": "^5.0.0"
  }
}
```

- [ ] **Step 2: Write config files**

`electron.vite.config.ts`:

```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer'), '@shared': resolve('src/shared') } },
    plugins: [react()]
  }
})
```

`tsconfig.json`:

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
```

`tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node", "electron-vite/node"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*", "tests/**/*", "*.config.ts"]
}
```

`tsconfig.web.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/renderer/*"], "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

`vitest.config.ts`:

```ts
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
})
```

`.gitignore`:

```
node_modules/
out/
dist/
*.log
```

- [ ] **Step 3: Write entry files**

`index.html`:

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'" />
    <title>trading-view</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

`src/main/index.ts`:

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0B0E11',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('ready-to-show', () => win.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

`src/preload/index.ts`:

```ts
// window.api is populated in Task 7. Empty bridge for now so preload builds.
export {}
```

`src/renderer/main.tsx`:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`src/renderer/App.tsx`:

```tsx
export default function App(): React.JSX.Element {
  return (
    <div style={{ height: '100vh', background: '#0B0E11', color: '#E4E7EB' }}>
      trading-view
    </div>
  )
}
```

`src/renderer/index.css`:

```css
:root { color-scheme: dark; }
html, body, #root { margin: 0; height: 100%; }
body { font-family: ui-sans-serif, -apple-system, "Segoe UI", sans-serif; }
```

- [ ] **Step 4: Install and verify build**

Run: `npm install`
Then: `npm run build`
Expected: builds `out/main`, `out/preload`, `out/renderer` with no errors.

- [ ] **Step 5: Verify dev launch**

Run: `npm run dev`
Expected: a dark (#0B0E11) window opens showing "trading-view". Close it.

- [ ] **Step 6: Verify Vitest runs**

Run: `npm test`
Expected: "No test files found" (exit 0) — Vitest is wired, no tests yet.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(01): scaffold electron-vite + react + ts + vitest"
```

---

### Task 2: Tailwind + shadcn/ui (zinc, dark-only) + design tokens

**Files:**
- Create: `tailwind.config.js`, `postcss.config.js`, `components.json`
- Modify: `src/renderer/index.css` (Tailwind directives + palette CSS vars), `src/renderer/App.tsx` (verify a Button)

**Interfaces:**
- Produces: shadcn components installable under `src/renderer/components/ui/`; exact `01-UI-SPEC.md` palette as CSS variables.

- [ ] **Step 1: Install Tailwind + shadcn deps**

Run:
```bash
npm install -D tailwindcss@^3.4.0 postcss autoprefixer
npm install class-variance-authority clsx tailwind-merge lucide-react tailwindcss-animate
```

- [ ] **Step 2: Write `tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' }
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
}
```

`postcss.config.js`:

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
```

- [ ] **Step 3: Write `components.json`** (so `npx shadcn add` targets renderer)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/renderer/index.css",
    "baseColor": "zinc",
    "cssVariables": true
  },
  "aliases": { "components": "@/components", "utils": "@/lib/utils" }
}
```

- [ ] **Step 4: Rewrite `src/renderer/index.css` with Tailwind + exact UI-SPEC palette**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Dark-only. Values mapped to 01-UI-SPEC.md palette.
   #0B0E11 background, #151920 secondary/card/popover, #2E7DE1 accent(primary),
   #E5484D destructive, #E4E7EB text, #8B92A0 muted text. */
:root, .dark {
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

* { border-color: hsl(var(--border)); }
html, body, #root { margin: 0; height: 100%; }
body {
  font-family: ui-sans-serif, -apple-system, "Segoe UI", sans-serif;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
```

- [ ] **Step 5: Add shadcn utils + components**

Run:
```bash
npx shadcn@latest add button input dialog command alert
```
Expected: creates `src/renderer/components/ui/{button,input,dialog,command,alert}.tsx` and `src/renderer/lib/utils.ts`. If the CLI prompts, accept defaults (it reads `components.json`).

- [ ] **Step 6: Verify a Button renders with dark tokens**

Modify `src/renderer/App.tsx`:

```tsx
import { Button } from '@/components/ui/button'

export default function App(): React.JSX.Element {
  return (
    <div className="h-screen bg-background text-foreground p-8">
      <h1 className="text-lg font-semibold">trading-view</h1>
      <Button className="mt-4">Search</Button>
    </div>
  )
}
```

Run: `npm run dev`
Expected: dark window, "Search" button rendered with blue (#2E7DE1) primary background. Close it.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(01): tailwind + shadcn/ui zinc dark-only + UI-SPEC palette"
```

---

### Task 3: Shared types + SQLite schema + db client + barStore

**Files:**
- Create: `src/shared/types.ts`, `src/main/db/schema.ts`, `src/main/db/client.ts`, `src/main/db/barStore.ts`
- Test: `tests/main/db/coverageFromBars.test.ts`

**Interfaces:**
- Produces:
  - `type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number }`
  - `type SymbolResult = { symbol: string; name: string; exchange: string }`
  - `type Timeframe = '1d'`
  - `type DateRange = { from: number; to: number } | undefined`
  - `coverageFromBars(bars: Bar[]): { oldestTime: number; newestTime: number } | null`
  - `barStore` with `getCoverage(symbol, tf)`, `getBars(symbol, tf, range)`, `upsertBarsAndCoverage(symbol, tf, bars)`
  - `getDb(): BetterSQLite3Database` (opens `userData/cache.db`, ensures tables)

- [ ] **Step 1: Write `src/shared/types.ts`**

```ts
export type Timeframe = '1d'

export type Bar = {
  time: number // UTC epoch seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type SymbolResult = {
  symbol: string
  name: string
  exchange: string
}

export type DateRange = { from: number; to: number } | undefined
```

- [ ] **Step 2: Write the failing test for `coverageFromBars`**

`tests/main/db/coverageFromBars.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { coverageFromBars } from '../../../src/main/db/barStore'
import type { Bar } from '@shared/types'

const bar = (time: number): Bar => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 })

describe('coverageFromBars', () => {
  it('returns null for empty input', () => {
    expect(coverageFromBars([])).toBeNull()
  })
  it('returns min and max time regardless of order', () => {
    expect(coverageFromBars([bar(300), bar(100), bar(200)])).toEqual({ oldestTime: 100, newestTime: 300 })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- coverageFromBars`
Expected: FAIL — `coverageFromBars` is not exported / module not found.

- [ ] **Step 4: Write `src/main/db/schema.ts`**

```ts
import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core'

export const bars = sqliteTable(
  'bars',
  {
    symbol: text('symbol').notNull(),
    timeframe: text('timeframe').notNull(),
    time: integer('time').notNull(), // UTC epoch seconds
    open: real('open').notNull(),
    high: real('high').notNull(),
    low: real('low').notNull(),
    close: real('close').notNull(),
    volume: real('volume').notNull()
  },
  (t) => ({ pk: primaryKey({ columns: [t.symbol, t.timeframe, t.time] }) })
)

export const coverage = sqliteTable(
  'coverage',
  {
    symbol: text('symbol').notNull(),
    timeframe: text('timeframe').notNull(),
    oldestTime: integer('oldest_time').notNull(),
    newestTime: integer('newest_time').notNull()
  },
  (t) => ({ pk: primaryKey({ columns: [t.symbol, t.timeframe] }) })
)
```

- [ ] **Step 5: Write `src/main/db/client.ts`**

```ts
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let _db: BetterSQLite3Database | null = null

export function getDb(): BetterSQLite3Database {
  if (_db) return _db
  const sqlite = new Database(join(app.getPath('userData'), 'cache.db'))
  sqlite.pragma('journal_mode = WAL')
  // ponytail: raw CREATE TABLE IF NOT EXISTS instead of drizzle-kit migrations — 2 fixed tables, no schema churn in P1
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS bars (
      symbol TEXT NOT NULL, timeframe TEXT NOT NULL, time INTEGER NOT NULL,
      open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL,
      PRIMARY KEY (symbol, timeframe, time)
    );
    CREATE TABLE IF NOT EXISTS coverage (
      symbol TEXT NOT NULL, timeframe TEXT NOT NULL,
      oldest_time INTEGER NOT NULL, newest_time INTEGER NOT NULL,
      PRIMARY KEY (symbol, timeframe)
    );
  `)
  _db = drizzle(sqlite)
  return _db
}
```

- [ ] **Step 6: Write `src/main/db/barStore.ts`**

```ts
import { and, eq, gte, lte, asc } from 'drizzle-orm'
import type { Bar, Timeframe, DateRange } from '@shared/types'
import { getDb } from './client'
import { bars, coverage } from './schema'

export function coverageFromBars(input: Bar[]): { oldestTime: number; newestTime: number } | null {
  if (input.length === 0) return null
  let oldest = input[0].time
  let newest = input[0].time
  for (const b of input) {
    if (b.time < oldest) oldest = b.time
    if (b.time > newest) newest = b.time
  }
  return { oldestTime: oldest, newestTime: newest }
}

export function getCoverage(symbol: string, tf: Timeframe): { oldestTime: number; newestTime: number } | null {
  const row = getDb().select().from(coverage)
    .where(and(eq(coverage.symbol, symbol), eq(coverage.timeframe, tf))).get()
  return row ? { oldestTime: row.oldestTime, newestTime: row.newestTime } : null
}

export function getBars(symbol: string, tf: Timeframe, range: DateRange): Bar[] {
  const conds = [eq(bars.symbol, symbol), eq(bars.timeframe, tf)]
  if (range) conds.push(gte(bars.time, range.from), lte(bars.time, range.to))
  const rows = getDb().select().from(bars).where(and(...conds)).orderBy(asc(bars.time)).all()
  return rows.map((r) => ({
    time: r.time, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume
  }))
}

export function upsertBarsAndCoverage(symbol: string, tf: Timeframe, input: Bar[]): void {
  const cov = coverageFromBars(input)
  if (!cov) return
  const db = getDb()
  db.insert(bars)
    .values(input.map((b) => ({ symbol, timeframe: tf, ...b })))
    .onConflictDoUpdate({
      target: [bars.symbol, bars.timeframe, bars.time],
      set: { open: bars.open, high: bars.high, low: bars.low, close: bars.close, volume: bars.volume }
    })
    .run()
  db.insert(coverage)
    .values({ symbol, timeframe: tf, ...cov })
    .onConflictDoUpdate({
      target: [coverage.symbol, coverage.timeframe],
      set: { oldestTime: cov.oldestTime, newestTime: cov.newestTime }
    })
    .run()
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- coverageFromBars`
Expected: PASS (2 tests). Only `coverageFromBars` is exercised — the drizzle-bound functions are verified in the app smoke check (Task 11), not in Vitest (native ABI).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(01): shared types + sqlite schema, db client, barStore"
```

---

### Task 4: FMP provider — zod schemas + fetch + mapping

**Files:**
- Create: `src/main/providers/IDataProvider.ts`, `src/main/providers/fmp.schema.ts`, `src/main/providers/FmpProvider.ts`
- Create fixtures: `tests/fixtures/fmp-historical.json`, `tests/fixtures/fmp-search.json`, `tests/fixtures/fmp-error.json`
- Test: `tests/main/providers/FmpProvider.test.ts`

**Interfaces:**
- Consumes: `Bar`, `SymbolResult`, `Timeframe`, `DateRange` from `@shared/types`.
- Produces:
  - `interface IDataProvider { searchSymbols(query): Promise<SymbolResult[]>; getOHLCV(symbol, tf, range): Promise<Bar[]> }`
  - `class FmpProvider` constructed as `new FmpProvider({ apiKey, httpGetJson })` where `httpGetJson: (url: string) => Promise<unknown>` is injected (defaults to a `fetch`-based impl) so tests supply fixtures without network.

- [ ] **Step 1: Write `src/main/providers/IDataProvider.ts`**

```ts
import type { Bar, SymbolResult, Timeframe, DateRange } from '@shared/types'

export interface IDataProvider {
  searchSymbols(query: string): Promise<SymbolResult[]>
  getOHLCV(symbol: string, timeframe: Timeframe, range: DateRange): Promise<Bar[]>
}
```

- [ ] **Step 2: Write fixtures**

`tests/fixtures/fmp-historical.json` (shape of FMP `/v3/historical-price-full/{symbol}`):

```json
{
  "symbol": "AAPL",
  "historical": [
    { "date": "2024-01-03", "open": 184.22, "high": 185.88, "low": 183.43, "close": 184.25, "volume": 58414500 },
    { "date": "2024-01-02", "open": 187.15, "high": 188.44, "low": 183.89, "close": 185.64, "volume": 82488700 }
  ]
}
```

`tests/fixtures/fmp-search.json` (shape of FMP `/v3/search`):

```json
[
  { "symbol": "AAPL", "name": "Apple Inc.", "currency": "USD", "stockExchange": "NASDAQ Global Select", "exchangeShortName": "NASDAQ" },
  { "symbol": "AAPL.NE", "name": "Apple Inc. (CAD-Hedged)", "currency": "CAD", "stockExchange": "NEO", "exchangeShortName": "NEO" }
]
```

`tests/fixtures/fmp-error.json` (FMP error body returned with HTTP 200):

```json
{ "Error Message": "Invalid API KEY. Please retry or visit our documentation" }
```

- [ ] **Step 3: Write the failing test**

`tests/main/providers/FmpProvider.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { FmpProvider } from '../../../src/main/providers/FmpProvider'

const fx = (name: string) => JSON.parse(readFileSync(join(__dirname, '../../fixtures', name), 'utf8'))
const provider = (payload: unknown) =>
  new FmpProvider({ apiKey: 'k', httpGetJson: async () => payload })

describe('FmpProvider.getOHLCV', () => {
  it('maps historical bars to ascending epoch-seconds Bars', async () => {
    const bars = await provider(fx('fmp-historical.json')).getOHLCV('AAPL', '1d', undefined)
    expect(bars).toHaveLength(2)
    expect(bars[0].time).toBe(Math.floor(Date.parse('2024-01-02T00:00:00Z') / 1000))
    expect(bars[1].time).toBe(Math.floor(Date.parse('2024-01-03T00:00:00Z') / 1000))
    expect(bars[0].time).toBeLessThan(bars[1].time) // ascending
    expect(bars[1].close).toBe(184.25)
  })
  it('throws on an error-shaped 200 payload, never returning bars', async () => {
    await expect(provider(fx('fmp-error.json')).getOHLCV('AAPL', '1d', undefined)).rejects.toThrow()
  })
})

describe('FmpProvider.searchSymbols', () => {
  it('maps search results to SymbolResult, preferring exchangeShortName', async () => {
    const results = await provider(fx('fmp-search.json')).searchSymbols('AAPL')
    expect(results[0]).toEqual({ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' })
    expect(results).toHaveLength(2)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- FmpProvider`
Expected: FAIL — cannot find `FmpProvider`.

- [ ] **Step 5: Write `src/main/providers/fmp.schema.ts`**

```ts
import { z } from 'zod'

export const fmpHistoricalRow = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number()
})

export const fmpHistoricalResponse = z.object({
  symbol: z.string(),
  historical: z.array(fmpHistoricalRow)
})

export const fmpSearchRow = z.object({
  symbol: z.string(),
  name: z.string().nullable().optional(),
  exchangeShortName: z.string().nullable().optional(),
  stockExchange: z.string().nullable().optional()
})

export const fmpSearchResponse = z.array(fmpSearchRow)
```

- [ ] **Step 6: Write `src/main/providers/FmpProvider.ts`**

```ts
import type { Bar, SymbolResult, Timeframe, DateRange } from '@shared/types'
import type { IDataProvider } from './IDataProvider'
import { fmpHistoricalResponse, fmpSearchResponse } from './fmp.schema'

const BASE = 'https://financialmodelingprep.com/api/v3'

type HttpGetJson = (url: string) => Promise<unknown>

const defaultHttpGetJson: HttpGetJson = async (url) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`FMP HTTP ${res.status}`)
  return res.json()
}

function dateToEpochSeconds(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000)
}

export class FmpProvider implements IDataProvider {
  private readonly apiKey: string
  private readonly httpGetJson: HttpGetJson

  constructor(opts: { apiKey: string; httpGetJson?: HttpGetJson }) {
    this.apiKey = opts.apiKey
    this.httpGetJson = opts.httpGetJson ?? defaultHttpGetJson
  }

  async searchSymbols(query: string): Promise<SymbolResult[]> {
    const url = `${BASE}/search?query=${encodeURIComponent(query)}&limit=8&apikey=${this.apiKey}`
    // zod .parse throws on error-shaped payloads → never surfaces bad data
    const rows = fmpSearchResponse.parse(await this.httpGetJson(url))
    return rows.map((r) => ({
      symbol: r.symbol,
      name: r.name ?? r.symbol,
      exchange: r.exchangeShortName ?? r.stockExchange ?? ''
    }))
  }

  async getOHLCV(symbol: string, _timeframe: Timeframe, _range: DateRange): Promise<Bar[]> {
    // P1: daily EOD only, full history in one request (D-08). timeframe/range are the P2 seam.
    const url = `${BASE}/historical-price-full/${encodeURIComponent(symbol)}?apikey=${this.apiKey}`
    const parsed = fmpHistoricalResponse.parse(await this.httpGetJson(url))
    return parsed.historical
      .map((r) => ({
        time: dateToEpochSeconds(r.date),
        open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume
      }))
      .sort((a, b) => a.time - b.time) // FMP returns newest-first; charts need ascending
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- FmpProvider`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(01): FmpProvider with zod validation + bar mapping"
```

> **ponytail note:** FMP v3 endpoint shapes are MEDIUM confidence (STATE.md). If a real key reveals different paths (e.g. `/stable/`), only `BASE` and the two URLs change — the seam and tests hold.

---

### Task 5: CacheService read-through orchestration

**Files:**
- Create: `src/main/cache/CacheService.ts`
- Test: `tests/main/cache/CacheService.test.ts`

**Interfaces:**
- Consumes: `IDataProvider`; a `BarStore` shape `{ getCoverage, getBars, upsertBarsAndCoverage }` (satisfied by `barStore.ts` in the app, by a fake in tests).
- Produces: `createCacheService({ provider, store })` returning `{ getOHLCV(symbol, tf, range): Promise<Bar[]> }`.

- [ ] **Step 1: Write the failing test**

`tests/main/cache/CacheService.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createCacheService } from '../../../src/main/cache/CacheService'
import type { Bar } from '@shared/types'

const bar = (time: number): Bar => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 })

function fakeStore(initialBars: Bar[] = [], cov: { oldestTime: number; newestTime: number } | null = null) {
  let stored = [...initialBars]
  let coverage = cov
  return {
    getCoverage: vi.fn(() => coverage),
    getBars: vi.fn(() => [...stored].sort((a, b) => a.time - b.time)),
    upsertBarsAndCoverage: vi.fn((_s: string, _tf: string, bars: Bar[]) => {
      stored = bars
      coverage = { oldestTime: Math.min(...bars.map((b) => b.time)), newestTime: Math.max(...bars.map((b) => b.time)) }
    })
  }
}

describe('CacheService.getOHLCV', () => {
  it('fetches from provider and writes cache on a miss (no coverage)', async () => {
    const store = fakeStore()
    const provider = { getOHLCV: vi.fn(async () => [bar(100), bar(200)]), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store })

    const bars = await svc.getOHLCV('AAPL', '1d', undefined)

    expect(provider.getOHLCV).toHaveBeenCalledOnce()
    expect(store.upsertBarsAndCoverage).toHaveBeenCalledOnce()
    expect(bars.map((b) => b.time)).toEqual([100, 200])
  })

  it('serves from cache with NO provider call when coverage exists (undefined range)', async () => {
    const store = fakeStore([bar(100), bar(200)], { oldestTime: 100, newestTime: 200 })
    const provider = { getOHLCV: vi.fn(), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store })

    const bars = await svc.getOHLCV('AAPL', '1d', undefined)

    expect(provider.getOHLCV).not.toHaveBeenCalled()
    expect(bars.map((b) => b.time)).toEqual([100, 200])
  })

  it('serves from cache when requested range is inside coverage', async () => {
    const store = fakeStore([bar(100), bar(150), bar(200)], { oldestTime: 100, newestTime: 200 })
    const provider = { getOHLCV: vi.fn(), searchSymbols: vi.fn() }
    const svc = createCacheService({ provider, store })

    await svc.getOHLCV('AAPL', '1d', { from: 120, to: 180 })

    expect(provider.getOHLCV).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- CacheService`
Expected: FAIL — cannot find `createCacheService`.

- [ ] **Step 3: Write `src/main/cache/CacheService.ts`**

```ts
import type { Bar, Timeframe, DateRange } from '@shared/types'
import type { IDataProvider } from '../providers/IDataProvider'

export interface BarStore {
  getCoverage(symbol: string, tf: Timeframe): { oldestTime: number; newestTime: number } | null
  getBars(symbol: string, tf: Timeframe, range: DateRange): Bar[]
  upsertBarsAndCoverage(symbol: string, tf: Timeframe, bars: Bar[]): void
}

function covers(
  cov: { oldestTime: number; newestTime: number } | null,
  range: DateRange
): boolean {
  if (!cov) return false
  if (!range) return true // any coverage satisfies an "all available" request in P1 (D-08)
  return cov.oldestTime <= range.from && cov.newestTime >= range.to
}

export function createCacheService(deps: { provider: IDataProvider; store: BarStore }) {
  const { provider, store } = deps
  return {
    async getOHLCV(symbol: string, tf: Timeframe, range: DateRange): Promise<Bar[]> {
      const cov = store.getCoverage(symbol, tf)
      if (covers(cov, range)) {
        return store.getBars(symbol, tf, range) // cache hit → no network
      }
      // P1: miss → fetch all history once, persist, then serve
      const fetched = await provider.getOHLCV(symbol, tf, undefined)
      store.upsertBarsAndCoverage(symbol, tf, fetched)
      return store.getBars(symbol, tf, range)
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- CacheService`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(01): CacheService read-through orchestration"
```

---

### Task 6: keystore + settings + search cache

**Files:**
- Create: `src/main/keystore.ts`, `src/main/settings.ts`, `src/main/searchCache.ts`
- Test: `tests/main/searchCache.test.ts`

**Interfaces:**
- Produces:
  - keystore: `setApiKey(key): { ok: boolean; encryptionAvailable: boolean }`, `getApiKey(): string | null`, `getKeyStatus(): { hasKey: boolean; encryptionAvailable: boolean }`, `clearApiKey(): void`
  - settings: `getLastSymbol(): string | null`, `setLastSymbol(symbol): void`
  - searchCache: `createSearchCache({ ttlMs, now })` → `{ get(query): SymbolResult[] | undefined; set(query, results): void }`

- [ ] **Step 1: Write the failing test for `searchCache`**

`tests/main/searchCache.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createSearchCache } from '../../src/main/searchCache'
import type { SymbolResult } from '@shared/types'

const results: SymbolResult[] = [{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' }]

describe('createSearchCache', () => {
  it('returns undefined for an unknown query', () => {
    const cache = createSearchCache({ ttlMs: 1000, now: () => 0 })
    expect(cache.get('AAPL')).toBeUndefined()
  })
  it('returns cached results within the TTL window', () => {
    let t = 0
    const cache = createSearchCache({ ttlMs: 1000, now: () => t })
    cache.set('AAPL', results)
    t = 999
    expect(cache.get('AAPL')).toEqual(results)
  })
  it('expires results after the TTL window', () => {
    let t = 0
    const cache = createSearchCache({ ttlMs: 1000, now: () => t })
    cache.set('AAPL', results)
    t = 1001
    expect(cache.get('AAPL')).toBeUndefined()
  })
  it('normalizes query casing and whitespace', () => {
    const cache = createSearchCache({ ttlMs: 1000, now: () => 0 })
    cache.set('  aapl ', results)
    expect(cache.get('AAPL')).toEqual(results)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- searchCache`
Expected: FAIL — cannot find `createSearchCache`.

- [ ] **Step 3: Write `src/main/searchCache.ts`**

```ts
import type { SymbolResult } from '@shared/types'

// ponytail: in-memory Map with TTL, cleared on process exit — no persistence needed (D-02)
export function createSearchCache(opts: { ttlMs: number; now: () => number }) {
  const { ttlMs, now } = opts
  const map = new Map<string, { at: number; results: SymbolResult[] }>()
  const key = (q: string) => q.trim().toLowerCase()
  return {
    get(query: string): SymbolResult[] | undefined {
      const hit = map.get(key(query))
      if (!hit) return undefined
      if (now() - hit.at >= ttlMs) {
        map.delete(key(query))
        return undefined
      }
      return hit.results
    },
    set(query: string, results: SymbolResult[]): void {
      map.set(key(query), { at: now(), results })
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- searchCache`
Expected: PASS (4 tests).

- [ ] **Step 5: Write `src/main/keystore.ts`** (native — verified in Task 11, not Vitest)

```ts
import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'

const keyPath = (): string => join(app.getPath('userData'), 'apikey.enc')
let cached: string | null = null

export function setApiKey(key: string): { ok: boolean; encryptionAvailable: boolean } {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  if (!encryptionAvailable) {
    // D-05: do not silently write plaintext. Keep only in memory for this session; caller warns the user.
    cached = key
    return { ok: false, encryptionAvailable: false }
  }
  writeFileSync(keyPath(), safeStorage.encryptString(key))
  cached = key
  return { ok: true, encryptionAvailable: true }
}

export function getApiKey(): string | null {
  if (cached !== null) return cached
  if (!existsSync(keyPath()) || !safeStorage.isEncryptionAvailable()) return null
  cached = safeStorage.decryptString(readFileSync(keyPath()))
  return cached
}

export function getKeyStatus(): { hasKey: boolean; encryptionAvailable: boolean } {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  const hasKey = cached !== null || existsSync(keyPath())
  return { hasKey, encryptionAvailable }
}

export function clearApiKey(): void {
  cached = null
  if (existsSync(keyPath())) rmSync(keyPath())
}
```

- [ ] **Step 6: Write `src/main/settings.ts`** (native — verified in Task 11)

```ts
import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

// ponytail: one small JSON under userData, not electron-store — no dependency for one field (design doc)
const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

function read(): Record<string, unknown> {
  if (!existsSync(settingsPath())) return {}
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8'))
  } catch {
    return {} // corrupt file → treat as empty; next write heals it
  }
}

export function getLastSymbol(): string | null {
  const v = read().lastSymbol
  return typeof v === 'string' ? v : null
}

export function setLastSymbol(symbol: string): void {
  writeFileSync(settingsPath(), JSON.stringify({ ...read(), lastSymbol: symbol }))
}
```

- [ ] **Step 7: Verify build still compiles**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(01): keystore (safeStorage), settings JSON, search cache"
```

---

### Task 7: IPC contract — shared channel types, main handlers, preload bridge

**Files:**
- Create: `src/shared/ipc.ts`
- Create: `src/main/ipc.ts`
- Modify: `src/main/index.ts` (call `registerIpc()` before window creation)
- Modify: `src/preload/index.ts` (expose typed `window.api`)

**Interfaces:**
- Consumes: `FmpProvider`, `createCacheService`, `barStore`, keystore, settings, searchCache, shared types.
- Produces: `window.api` (type `Api`) in the renderer:
  - `api.symbols.search(query): Promise<SymbolResult[]>`
  - `api.ohlcv.get(symbol, timeframe, range): Promise<Bar[]>`
  - `api.apikey.set(key): Promise<{ ok: boolean; encryptionAvailable: boolean }>`
  - `api.apikey.status(): Promise<{ hasKey: boolean; encryptionAvailable: boolean }>`
  - `api.apikey.clear(): Promise<void>`
  - `api.settings.getLastSymbol(): Promise<string | null>`
  - `api.settings.setLastSymbol(symbol): Promise<void>`

- [ ] **Step 1: Write `src/shared/ipc.ts`**

```ts
import type { Bar, SymbolResult, Timeframe, DateRange } from './types'

export const CH = {
  symbolsSearch: 'symbols:search',
  ohlcvGet: 'ohlcv:get',
  apikeySet: 'apikey:set',
  apikeyStatus: 'apikey:status',
  apikeyClear: 'apikey:clear',
  settingsGetLastSymbol: 'settings:getLastSymbol',
  settingsSetLastSymbol: 'settings:setLastSymbol'
} as const

export type KeyStatus = { hasKey: boolean; encryptionAvailable: boolean }
export type SetKeyResult = { ok: boolean; encryptionAvailable: boolean }

export interface Api {
  symbols: { search(query: string): Promise<SymbolResult[]> }
  ohlcv: { get(symbol: string, timeframe: Timeframe, range: DateRange): Promise<Bar[]> }
  apikey: {
    set(key: string): Promise<SetKeyResult>
    status(): Promise<KeyStatus>
    clear(): Promise<void>
  }
  settings: {
    getLastSymbol(): Promise<string | null>
    setLastSymbol(symbol: string): Promise<void>
  }
}

declare global {
  interface Window {
    api: Api
  }
}
```

- [ ] **Step 2: Write `src/main/ipc.ts`**

```ts
import { ipcMain } from 'electron'
import type { Timeframe, DateRange } from '@shared/types'
import { CH } from '@shared/ipc'
import { FmpProvider } from './providers/FmpProvider'
import { createCacheService } from './cache/CacheService'
import * as barStore from './db/barStore'
import { getApiKey, setApiKey, getKeyStatus, clearApiKey } from './keystore'
import { getLastSymbol, setLastSymbol } from './settings'
import { createSearchCache } from './searchCache'

export function registerIpc(): void {
  const searchCache = createSearchCache({ ttlMs: 5 * 60 * 1000, now: () => Date.now() })

  const cacheFor = () => {
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('NO_API_KEY')
    return createCacheService({ provider: new FmpProvider({ apiKey }), store: barStore })
  }

  ipcMain.handle(CH.symbolsSearch, async (_e, query: string) => {
    const cached = searchCache.get(query)
    if (cached) return cached
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('NO_API_KEY')
    const results = await new FmpProvider({ apiKey }).searchSymbols(query)
    searchCache.set(query, results)
    return results
  })

  ipcMain.handle(CH.ohlcvGet, async (_e, symbol: string, timeframe: Timeframe, range: DateRange) =>
    cacheFor().getOHLCV(symbol, timeframe, range)
  )

  ipcMain.handle(CH.apikeySet, (_e, key: string) => setApiKey(key))
  ipcMain.handle(CH.apikeyStatus, () => getKeyStatus())
  ipcMain.handle(CH.apikeyClear, () => clearApiKey())
  ipcMain.handle(CH.settingsGetLastSymbol, () => getLastSymbol())
  ipcMain.handle(CH.settingsSetLastSymbol, (_e, symbol: string) => setLastSymbol(symbol))
}
```

- [ ] **Step 3: Wire `registerIpc()` into `src/main/index.ts`**

Add the import at the top and call it inside `app.whenReady()` before `createWindow()`:

```ts
import { registerIpc } from './ipc'
```

Change the `whenReady` block to:

```ts
app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
```

- [ ] **Step 4: Write `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { Timeframe, DateRange } from '@shared/types'
import { CH, type Api } from '@shared/ipc'

const api: Api = {
  symbols: { search: (query) => ipcRenderer.invoke(CH.symbolsSearch, query) },
  ohlcv: {
    get: (symbol, timeframe: Timeframe, range: DateRange) =>
      ipcRenderer.invoke(CH.ohlcvGet, symbol, timeframe, range)
  },
  apikey: {
    set: (key) => ipcRenderer.invoke(CH.apikeySet, key),
    status: () => ipcRenderer.invoke(CH.apikeyStatus),
    clear: () => ipcRenderer.invoke(CH.apikeyClear)
  },
  settings: {
    getLastSymbol: () => ipcRenderer.invoke(CH.settingsGetLastSymbol),
    setLastSymbol: (symbol) => ipcRenderer.invoke(CH.settingsSetLastSymbol, symbol)
  }
}

contextBridge.exposeInMainWorld('api', api)
```

- [ ] **Step 5: Verify build compiles**

Run: `npm run build`
Expected: no TypeScript errors across main/preload/renderer.

- [ ] **Step 6: Verify `window.api` exists at runtime**

Run: `npm run dev`. In the app's DevTools console (View → Toggle Developer Tools) type:
```js
Object.keys(window.api)
```
Expected: `["symbols", "ohlcv", "apikey", "settings"]`. Then run `await window.api.apikey.status()` → `{hasKey:false, encryptionAvailable:true}` (no key set yet), and confirm **no** method returns the raw key. Close app.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(01): typed IPC contract — main handlers + preload bridge"
```

---

### Task 8: Renderer store + api wrappers + TanStack Query

**Files:**
- Create: `src/renderer/store.ts`, `src/renderer/api.ts`
- Modify: `src/renderer/main.tsx` (wrap with `QueryClientProvider`)

**Interfaces:**
- Produces:
  - `useAppStore` (Zustand) with `{ activeSymbol: string | null; setActiveSymbol(s): void }`
  - `api` re-export of `window.api` (single import point for renderer)
  - query keys `qk.ohlcv(symbol)` and `qk.search(query)`

- [ ] **Step 1: Write `src/renderer/api.ts`**

```ts
// Single renderer entry point to the preload bridge. Never touch window.api elsewhere.
export const api = window.api

export const qk = {
  ohlcv: (symbol: string) => ['ohlcv', symbol, '1d'] as const,
  search: (query: string) => ['search', query] as const
}
```

- [ ] **Step 2: Write `src/renderer/store.ts`**

```ts
import { create } from 'zustand'

type AppState = {
  activeSymbol: string | null
  setActiveSymbol: (symbol: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeSymbol: null,
  setActiveSymbol: (symbol) => set({ activeSymbol: symbol })
}))
```

- [ ] **Step 3: Wrap the app in `QueryClientProvider` — rewrite `src/renderer/main.tsx`**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, retry: 1, refetchOnWindowFocus: false }
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
)
```

- [ ] **Step 4: Verify build compiles**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(01): renderer store, api wrappers, TanStack Query provider"
```

---

### Task 9: Renderer UI — SearchBar, SearchResults, SettingsDialog

**Files:**
- Create: `src/renderer/components/SearchBar.tsx`, `src/renderer/components/SearchResults.tsx`, `src/renderer/components/SettingsDialog.tsx`
- Modify: `src/renderer/App.tsx` (compose header + search + settings; Chart added in Task 10)

**Interfaces:**
- Consumes: `api`, `qk`, `useAppStore`, shadcn `Button`/`Input`/`Dialog`/`Alert`, `SymbolResult`.
- Produces: user can type a query, confirm with Enter/button, see up to 8 results, select one (sets `activeSymbol` + persists via `settings.setLastSymbol`), and open Settings to save/clear the API key.

- [ ] **Step 1: Write `src/renderer/components/SearchResults.tsx`**

```tsx
import type { SymbolResult } from '@shared/types'

type Props = {
  loading: boolean
  error: boolean
  results: SymbolResult[] | undefined
  onSelect: (symbol: string) => void
}

export function SearchResults({ loading, error, results, onSelect }: Props): React.JSX.Element | null {
  if (loading) return <div className="p-2 text-sm text-muted-foreground">Searching…</div>
  if (error)
    return (
      <div className="p-2 text-sm text-destructive">
        Couldn't load chart data. Check your connection or your FMP API key in Settings, then try again.
      </div>
    )
  if (!results) return null
  if (results.length === 0)
    return (
      <div className="p-2">
        <div className="text-sm">No matches found</div>
        <div className="text-xs text-muted-foreground">
          Try a different ticker or company name. Search covers US stocks and crypto.
        </div>
      </div>
    )
  return (
    <ul className="max-h-[280px] overflow-y-auto rounded-md border border-border bg-card">
      {results.slice(0, 8).map((r) => (
        <li key={`${r.symbol}-${r.exchange}`}>
          <button
            onClick={() => onSelect(r.symbol)}
            className="flex w-full items-center gap-2 px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
          >
            <span className="font-semibold">{r.symbol}</span>
            <span className="truncate text-muted-foreground" title={r.name}>{r.name}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{r.exchange}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: Write `src/renderer/components/SearchBar.tsx`**

```tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, qk } from '@/api'
import { useAppStore } from '@/store'
import { SearchResults } from './SearchResults'

export function SearchBar(): React.JSX.Element {
  const [text, setText] = useState('')
  const [confirmed, setConfirmed] = useState('') // confirm-based search only (D-01)
  const setActiveSymbol = useAppStore((s) => s.setActiveSymbol)

  const q = useQuery({
    queryKey: qk.search(confirmed),
    queryFn: () => api.symbols.search(confirmed),
    enabled: confirmed.length > 0
  })

  const onSelect = (symbol: string): void => {
    setActiveSymbol(symbol)
    void api.settings.setLastSymbol(symbol)
    setConfirmed('') // collapse the results list after selection
    setText('')
  }

  return (
    <div className="relative w-[420px]">
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setConfirmed(text.trim()) }}
          placeholder="Search ticker or company (press Enter)"
        />
        <Button onClick={() => setConfirmed(text.trim())}>Search</Button>
      </div>
      {confirmed.length > 0 && (
        <div className="absolute z-10 mt-1 w-full">
          <SearchResults loading={q.isLoading} error={q.isError} results={q.data} onSelect={onSelect} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Write `src/renderer/components/SettingsDialog.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { api } from '@/api'

export function SettingsDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<{ hasKey: boolean; encryptionAvailable: boolean } | null>(null)

  useEffect(() => {
    if (open) void api.apikey.status().then(setStatus)
  }, [open])

  const save = async (): Promise<void> => {
    const res = await api.apikey.set(key)
    setKey('')
    setStatus(await api.apikey.status())
    if (!res.encryptionAvailable) return // warning already shown by status render below
  }

  const clear = async (): Promise<void> => {
    if (!confirm("Remove your saved FMP API key? You'll need to re-enter it to fetch new data. Already-cached charts keep working offline.")) return
    await api.apikey.clear()
    setStatus(await api.apikey.status())
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Settings</Button>
      </DialogTrigger>
      <DialogContent className="p-6">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        {status && !status.encryptionAvailable && (
          <Alert variant="destructive">
            <AlertDescription>
              Your OS doesn't support secure credential storage. Your API key will be saved in plain text on this
              device — avoid using this app on a shared machine until this is resolved.
            </AlertDescription>
          </Alert>
        )}
        <div className="mt-4 flex flex-col gap-3">
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
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Compose `src/renderer/App.tsx`** (Chart placeholder replaced in Task 10)

```tsx
import { SearchBar } from './components/SearchBar'
import { SettingsDialog } from './components/SettingsDialog'
import { useAppStore } from './store'

export default function App(): React.JSX.Element {
  const activeSymbol = useAppStore((s) => s.activeSymbol)
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-4 border-b border-border bg-card px-8 py-4">
        <span className="text-2xl font-semibold">{activeSymbol ?? '—'}</span>
        <div className="ml-auto flex items-center gap-4">
          <SearchBar />
          <SettingsDialog />
        </div>
      </header>
      <main className="flex-1 p-6">
        {activeSymbol
          ? <div className="text-muted-foreground">Chart for {activeSymbol} (Task 10)</div>
          : <div className="text-muted-foreground">Search a symbol to begin.</div>}
      </main>
    </div>
  )
}
```

- [ ] **Step 5: Verify build + manual search flow (needs a real FMP key)**

Run: `npm run dev`. Open Settings → paste a real FMP key → Save API Key. Type `AAPL`, press Enter.
Expected: "Searching…" then up to 8 result rows (symbol, name, exchange). Clicking a row sets the header ticker and shows the "Chart for AAPL (Task 10)" placeholder. Close app.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(01): search bar, results, settings dialog"
```

---

### Task 10: Chart rendering with lightweight-charts

**Files:**
- Create: `src/renderer/components/Chart.tsx`
- Modify: `src/renderer/App.tsx` (render `<Chart />` for the active symbol)

**Interfaces:**
- Consumes: `api`, `qk`, `useQuery`, lightweight-charts v5 (`createChart`, `CandlestickSeries`), `Bar`.
- Produces: a dark candlestick chart for `activeSymbol`, with loading/error states from UI-SPEC.

- [ ] **Step 1: Write `src/renderer/components/Chart.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import { api, qk } from '@/api'
import type { Bar } from '@shared/types'

export function Chart({ symbol }: { symbol: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  const q = useQuery<Bar[]>({
    queryKey: qk.ohlcv(symbol),
    queryFn: () => api.ohlcv.get(symbol, '1d', undefined)
  })

  // Create the chart once.
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: { background: { color: '#0B0E11' }, textColor: '#8B92A0' },
      grid: { vertLines: { color: '#151920' }, horzLines: { color: '#151920' } },
      autoSize: true,
      timeScale: { borderColor: '#151920' },
      rightPriceScale: { borderColor: '#151920' }
    })
    chart.addSeries(CandlestickSeries, {
      upColor: '#22C55E', wickUpColor: '#22C55E',
      downColor: '#EF4444', wickDownColor: '#EF4444',
      borderVisible: false
    })
    chartRef.current = chart
    seriesRef.current = chart.panes()[0].getSeries()[0] as ISeriesApi<'Candlestick'>
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null }
  }, [])

  // Push data whenever it changes.
  useEffect(() => {
    if (!seriesRef.current || !q.data) return
    seriesRef.current.setData(
      q.data.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close }))
    )
    chartRef.current?.timeScale().fitContent()
  }, [q.data])

  if (q.isLoading) return <div className="p-6 text-muted-foreground">Loading chart…</div>
  if (q.isError)
    return (
      <div className="p-6 text-destructive">
        Couldn't load chart data. Check your connection or your FMP API key in Settings, then try again.
      </div>
    )
  return <div ref={containerRef} className="h-full w-full" />
}
```

> **ponytail note:** lightweight-charts v5 renamed `addCandlestickSeries` → `addSeries(CandlestickSeries, opts)`. Keep the series handle from `addSeries`'s return if `panes()[0].getSeries()[0]` proves awkward — assign `seriesRef.current = chart.addSeries(...)` directly. Prefer whichever the installed 5.2 typings expose cleanly.

- [ ] **Step 2: Render `<Chart />` in `src/renderer/App.tsx`**

Replace the `<main>` block's placeholder branch:

```tsx
import { Chart } from './components/Chart'
```

```tsx
<main className="flex-1">
  {activeSymbol
    ? <Chart symbol={activeSymbol} />
    : <div className="p-6 text-muted-foreground">Search a symbol to begin.</div>}
</main>
```

- [ ] **Step 3: Verify build + candle render (real FMP key)**

Run: `npm run dev`. With a key saved, search and select `AAPL`.
Expected: "Loading chart…" briefly, then daily candlesticks render — green (#22C55E) up, red (#EF4444) down, dark background, full history fitted to view. Close app.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(01): daily candlestick chart via lightweight-charts"
```

---

### Task 11: Startup restore + end-to-end smoke verification

**Files:**
- Modify: `src/renderer/App.tsx` (restore last symbol → AAPL fallback on mount)

**Interfaces:**
- Consumes: `api.settings.getLastSymbol`, `useAppStore.setActiveSymbol`.
- Produces: on launch the app shows the last-viewed symbol (or `AAPL` on first run), satisfying CHART-01 / D-06 / D-07.

- [ ] **Step 1: Add startup restore to `src/renderer/App.tsx`**

Add inside the `App` component, before the return:

```tsx
import { useEffect } from 'react'
```

```tsx
const setActiveSymbol = useAppStore((s) => s.setActiveSymbol)
useEffect(() => {
  void api.settings.getLastSymbol().then((last) => setActiveSymbol(last ?? 'AAPL')) // D-06/D-07
}, [setActiveSymbol])
```

(Add the `import { api } from './api'` if not already present, and keep the existing `activeSymbol` selector.)

- [ ] **Step 2: Full clean-slate smoke test (real FMP key)**

Delete any prior app data first so the run is honest:
Run (PowerShell): `Remove-Item -Recurse -Force "$env:APPDATA\trading-view" -ErrorAction SilentlyContinue`
Then: `npm run dev`

Verify each success criterion:
1. **First-run fallback:** window opens on `AAPL` with a loading chart (Settings has no key yet → chart shows the error copy). Open Settings → Save a real key → search+select AAPL → candles render. ✅ (CHART-01, CHART-05 dark)
2. **Search + select:** search a second symbol (e.g. `MSFT` or `BTCUSD`), select it → chart switches. ✅ (DATA-01)
3. **Cache hit, no new FMP request:** open DevTools → Network tab (or add a temporary `console.log` in `FmpProvider.getOHLCV`). Re-select AAPL after MSFT. Expected: **no** FMP historical request fires for AAPL the second time — served from SQLite. ✅ (DATA-03)
4. **Provider seam:** confirm all fetching routes through `IDataProvider`/`CacheService` (code inspection — renderer never imports `fetch`/FMP). ✅ (DATA-02)
5. **Key security:** in DevTools console run `await window.api.apikey.status()` → returns `{hasKey:true, encryptionAvailable:true}`, never the key string. Confirm the key never appears in renderer state or console. Confirm `%APPDATA%\trading-view\apikey.enc` exists and is not human-readable. ✅ (DATA-05)
6. **Persistence across restart:** close and relaunch `npm run dev`. Expected: opens directly on the last-selected symbol, chart renders from cache with no FMP call. ✅ (CHART-01 restore / DATA-03)

- [ ] **Step 3: Run the full unit suite**

Run: `npm test`
Expected: all tests pass (coverageFromBars, FmpProvider, CacheService, searchCache).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(01): startup last-symbol restore + AAPL fallback"
```

---

## Self-Review

**Spec coverage** (design doc + CONTEXT decisions → task):
- IDataProvider pure adapter (Decision 1) → Task 4 ✅
- Explicit coverage table (Decision 2) → Task 3 ✅
- Read-through CacheService, cache-hit = no network (DATA-03, D-08/D-09) → Task 5, verified Task 11 ✅
- zod validation at FMP boundary, never cache bad data → Task 4 ✅
- safeStorage key, IPC-results-only, D-05 degrade (DATA-05, D-03/D-04/D-05) → Task 6 + Task 7, verified Task 11 ✅
- Confirm-based search + short cache (DATA-01, D-01/D-02) → Task 6 + Task 9 ✅
- Last-symbol restore + AAPL fallback (CHART-01, D-06/D-07) → Task 6 + Task 11 ✅
- Dark theme + exact palette (CHART-05) → Task 2 + Task 10 ✅
- Copywriting strings verbatim → Tasks 9, 10 ✅
- Vite pinned ^7, better-sqlite3 rebuild postinstall → Task 1 ✅
- shadcn zinc dark-only, blocks Button/Input/Dialog/Command/Alert → Task 2 ✅

**Placeholder scan:** No TBD/TODO. Every code step shows full code. The "(Task 10)" / "(Task N)" labels are forward-references in placeholder UI that the named task replaces, not unfilled work.

**Type consistency:** `Bar`, `SymbolResult`, `Timeframe`, `DateRange` defined once (Task 3) and consumed unchanged. `BarStore` shape (Task 5) matches `barStore.ts` exports (Task 3): `getCoverage`, `getBars`, `upsertBarsAndCoverage`. `Api` interface (Task 7) matches preload (Task 7) and renderer usage (Tasks 8–11). Coverage object shape `{oldestTime, newestTime}` consistent across barStore, CacheService, IPC.

**Known real-world checks flagged for execution:** FMP v3 endpoint shapes are MEDIUM confidence (isolated to `FmpProvider` `BASE`+URLs); `Command` shadcn block is installed in Task 2 but the search UI uses a plain list (Command is available if a combobox is preferred later — installing it satisfies the UI-SPEC registry contract without forcing its use).
