import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleGridShortcut, type ShortcutDeps, type ShortcutEvent } from '../../src/renderer/lib/gridShortcuts'

function makeDeps(overrides: Partial<ShortcutDeps> = {}): ShortcutDeps {
  return {
    reload: vi.fn(),
    copyCell: vi.fn(),
    cutCell: vi.fn(),
    pasteCell: vi.fn(),
    clearCell: vi.fn(),
    toggleWatchlist: vi.fn(),
    getActiveCellId: () => 'cell-1',
    getActiveSymbol: () => 'AAPL',
    hasSelection: () => false,
    ...overrides
  }
}

function ev(over: Partial<ShortcutEvent>): ShortcutEvent {
  return { key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false, target: { tagName: 'DIV' }, ...over }
}

describe('handleGridShortcut', () => {
  let deps: ShortcutDeps
  beforeEach(() => { deps = makeDeps() })

  it('Ctrl+R triggers reload and is handled', () => {
    expect(handleGridShortcut(ev({ key: 'r', ctrlKey: true }), deps)).toBe(true)
    expect(deps.reload).toHaveBeenCalledTimes(1)
  })

  it('F5 (no modifiers) triggers reload and is handled', () => {
    expect(handleGridShortcut(ev({ key: 'F5' }), deps)).toBe(true)
    expect(deps.reload).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+D toggles watchlist for the active symbol', () => {
    expect(handleGridShortcut(ev({ key: 'd', ctrlKey: true }), deps)).toBe(true)
    expect(deps.toggleWatchlist).toHaveBeenCalledWith('AAPL')
  })

  it('Ctrl+D with no active symbol is swallowed but toggles nothing', () => {
    deps = makeDeps({ getActiveSymbol: () => null })
    expect(handleGridShortcut(ev({ key: 'd', ctrlKey: true }), deps)).toBe(true)
    expect(deps.toggleWatchlist).not.toHaveBeenCalled()
  })

  it('Ctrl+C copies the active cell when no text is selected', () => {
    expect(handleGridShortcut(ev({ key: 'c', ctrlKey: true }), deps)).toBe(true)
    expect(deps.copyCell).toHaveBeenCalledWith('cell-1')
  })

  it('Ctrl+C falls through (returns false, no copy) when text is selected', () => {
    deps = makeDeps({ hasSelection: () => true })
    expect(handleGridShortcut(ev({ key: 'c', ctrlKey: true }), deps)).toBe(false)
    expect(deps.copyCell).not.toHaveBeenCalled()
  })

  it('Ctrl+X cuts, Ctrl+V pastes', () => {
    expect(handleGridShortcut(ev({ key: 'x', ctrlKey: true }), deps)).toBe(true)
    expect(deps.cutCell).toHaveBeenCalledWith('cell-1')
    expect(handleGridShortcut(ev({ key: 'v', ctrlKey: true }), deps)).toBe(true)
    expect(deps.pasteCell).toHaveBeenCalledWith('cell-1')
  })

  it('Delete clears the active cell', () => {
    expect(handleGridShortcut(ev({ key: 'Delete' }), deps)).toBe(true)
    expect(deps.clearCell).toHaveBeenCalledWith('cell-1')
  })

  it('ignores shortcuts when target is a form field', () => {
    const r = handleGridShortcut(ev({ key: 'c', ctrlKey: true, target: { tagName: 'INPUT' } }), deps)
    expect(r).toBe(false)
    expect(deps.copyCell).not.toHaveBeenCalled()
  })

  it('ignores shortcuts when target is contentEditable', () => {
    const r = handleGridShortcut(ev({ key: 'c', ctrlKey: true, target: { tagName: 'DIV', isContentEditable: true } }), deps)
    expect(r).toBe(false)
    expect(deps.copyCell).not.toHaveBeenCalled()
  })

  it('ignores shortcuts inside a dialog/menu (role match via closest)', () => {
    const target = { tagName: 'BUTTON', closest: (sel: string) => (sel.includes('dialog') ? {} : null) }
    expect(handleGridShortcut(ev({ key: 'Delete', target }), deps)).toBe(false)
    expect(deps.clearCell).not.toHaveBeenCalled()
  })

  it('ignores extra-modifier combos (Ctrl+Shift+C)', () => {
    expect(handleGridShortcut(ev({ key: 'c', ctrlKey: true, shiftKey: true }), deps)).toBe(false)
    expect(deps.copyCell).not.toHaveBeenCalled()
  })

  it('ignores key-repeat for mutating shortcuts (Ctrl+D held)', () => {
    expect(handleGridShortcut(ev({ key: 'd', ctrlKey: true, repeat: true }), deps)).toBe(false)
    expect(deps.toggleWatchlist).not.toHaveBeenCalled()
  })

  it('still handles repeated Ctrl+R (reload is inFlight-guarded upstream)', () => {
    expect(handleGridShortcut(ev({ key: 'r', ctrlKey: true, repeat: true }), deps)).toBe(true)
    expect(deps.reload).toHaveBeenCalledTimes(1)
  })
})
