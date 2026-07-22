# Company info as separate OS windows — Design

**Date:** 2026-07-22
**Status:** Approved (pending spec review)

## Problem

Company info is currently a Radix modal (`CompanyInfoDialog`) driven by a single
`companyInfoSymbol` in the store. Opening it blocks the whole app behind an overlay —
the chart grid can't be interacted with. We want company info shown in a way that
leaves the main screen fully usable, and lets the user compare multiple companies.

## Decision

Show company info in **separate OS windows** — one window per symbol.

- Opening a symbol that already has a window **focuses** that window.
- Opening a different symbol **spawns another** window (side-by-side compare).
- Native window frame (free close / move / resize; no custom titlebar).
- Closing the main window quits the app (company windows don't keep it alive).

## Content loading — reuse the existing renderer bundle

The company window loads the **same** `index.html` with a hash marker, e.g.
`#company=AAPL`. `main.tsx` reads the hash at boot: if a company symbol is present it
mounts `<CompanyWindow symbol>` instead of `<App>`. Everything else — preload, CSP,
`QueryClientProvider`, the `company:info` IPC, `CompanyInfoBody` — is reused as-is.

*Rejected:* a dedicated `company.html` entry. It needs electron-vite multi-entry build
config and duplicates the provider setup for zero benefit here.

## Components

### Main process (`src/main/index.ts`)
- Module-level `Map<string, BrowserWindow>` keyed by symbol.
- New IPC handler `company:openWindow(symbol)`:
  - If the symbol has a live window → `focus()` it.
  - Else create a ~480×680 `BrowserWindow` (native frame, resizable, dark
    `backgroundColor`, `show:false` → show on `ready-to-show`), load the renderer
    URL/file with `#company=${symbol}`, and `delete` from the map on `'closed'`.
  - Not a `parent` child window — so it can move to another monitor / sit behind main.
- When the **main** window closes, close all company windows (clean quit on Windows).

### Renderer
- `CompanyInfoDialog.tsx` → `CompanyWindow.tsx`:
  - Keep `CompanyInfoBody` verbatim (query, states, layout).
  - Drop the `Dialog` / `DialogContent` wrapper; wrap the body in a plain full-window
    scroll container with a small header.
  - Set `document.title` to the symbol (company name once loaded).
- `GridHost.tsx` and `Watchlist.tsx` context-menu items call
  `api.company.openWindow(symbol)` instead of `openCompanyInfo`.
- **Delete** store state `companyInfoSymbol` / `openCompanyInfo` / `closeCompanyInfo`
  and the `<CompanyInfoDialog />` mount in `App.tsx`.

### Plumbing
- `src/shared/ipc.ts`: add channel `company:openWindow`.
- `src/preload/index.ts`: add `company.openWindow(symbol)`.

## Data flow

context menu → `api.company.openWindow(symbol)` → main creates/focuses window → new
window boots the renderer in company mode → `CompanyInfoBody` runs its own
`useQuery(company:info)`.

The child window has its own TanStack cache, but the `company:info` service already
has a TTL/DB cache in main, so a repeat symbol is API-safe (no extra FMP hit).

## Error handling
- `CompanyInfoBody` keeps its existing loading / not-covered / generic-error states.
- If `company:openWindow` is called with a symbol whose window was just closed, the
  `'closed'` handler has already removed it from the map, so a fresh window is created.

## Testing
- Manual: right-click a chart cell / watchlist row → "Show company info" opens a
  window; main screen stays interactive; second symbol opens a second window; same
  symbol re-focuses; closing main quits the app.
- One runnable check: a small unit around the hash parse in `main.tsx`
  (`#company=AAPL` → `"AAPL"`, no hash → `null`) so the window/App branch can't
  silently break.

## Out of scope
- Persisting company-window positions across restarts.
- A window manager / tabbed company view.
