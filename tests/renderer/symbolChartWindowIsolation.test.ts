import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// SymbolChartWindow's isolation from the persisted workspace (D-XX symbol window) rests entirely
// on it never mounting useWorkspaceSync/useClipboardSync — every BrowserWindow gets its own
// renderer store, so skipping those hooks is what makes this window's chart state throwaway. If
// either hook were added, this window would hydrate the real workspace collection and its
// setActiveSymbol effect would overwrite the user's actual active grid cell, silently corrupting
// the persisted workspace on the next debounced save. No runtime assertion in this node-only
// harness (no DOM, no electron) can render the component and observe that regression, so a
// source-text check is the only tool available to guard the "must not import" invariant.
describe('SymbolChartWindow isolation contract', () => {
  it('never mounts useWorkspaceSync or useClipboardSync', () => {
    const src = readFileSync(join(__dirname, '../../src/renderer/components/SymbolChartWindow.tsx'), 'utf8')
    // The file's own explanatory comment names both hooks in prose ("does NOT mount
    // useWorkspaceSync or useClipboardSync") — strip // comment lines first so this check reacts
    // only to an actual import/call, not to the comment describing the invariant.
    const code = src.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/useWorkspaceSync|useClipboardSync/)
  })
})
