// Pure, DOM-free shortcut decision logic. The hook (useGridShortcuts) is a thin adapter that
// builds `deps` from the store/query-client and calls preventDefault when this returns true.
// Kept free of real DOM so it runs in the `node` Vitest environment.

export interface ShortcutEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  repeat: boolean
  target: unknown
}

export interface ShortcutDeps {
  reload: () => void
  copyCell: (id: string) => void
  cutCell: (id: string) => void
  pasteCell: (id: string) => void
  clearCell: (id: string) => void
  toggleWatchlist: (symbol: string) => void
  getActiveCellId: () => string
  getActiveSymbol: () => string | null
  hasSelection: () => boolean
}

// True when the event originated from a text field or from inside a dialog/menu — in those
// contexts native behavior (typing, native copy/paste/delete) must win.
function isEditableTarget(target: unknown): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null
  if (!el || typeof el !== 'object') return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  if (typeof el.closest === 'function' && el.closest('[role="dialog"], [role="menu"]')) return true
  return false
}

export function handleGridShortcut(e: ShortcutEvent, deps: ShortcutDeps): boolean {
  if (isEditableTarget(e.target)) return false

  const noMods = !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey
  const ctrlOnly = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey
  const key = e.key.toLowerCase()

  // Refresh — Ctrl+R / F5. reload() is guarded by an inFlight ref upstream, so repeats are no-ops;
  // always return true so Electron's built-in page reload never fires.
  if ((ctrlOnly && key === 'r') || (noMods && e.key === 'F5')) {
    deps.reload()
    return true
  }

  // Everything below mutates cells/watchlist — ignore auto-repeat from a held key.
  if (e.repeat) return false

  if (noMods && e.key === 'Delete') {
    deps.clearCell(deps.getActiveCellId())
    return true
  }
  if (ctrlOnly && key === 'd') {
    const sym = deps.getActiveSymbol()
    if (sym) deps.toggleWatchlist(sym)
    return true // swallow even with no symbol (avoid browser "bookmark" default)
  }
  if (ctrlOnly && key === 'c') {
    if (deps.hasSelection()) return false // let the browser copy selected text
    deps.copyCell(deps.getActiveCellId())
    return true
  }
  if (ctrlOnly && key === 'x') {
    deps.cutCell(deps.getActiveCellId())
    return true
  }
  if (ctrlOnly && key === 'v') {
    deps.pasteCell(deps.getActiveCellId())
    return true
  }

  return false
}
