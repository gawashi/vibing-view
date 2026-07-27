import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The symbol window's chart state is throwaway *only* because it never mounts these hooks — mount
// either and it hydrates the real workspace collection, so its seeded symbol overwrites the user's
// active grid cell on the next debounced save. No DOM/electron in this harness, so a source check.
describe('SymbolChartWindow isolation contract', () => {
  it('never mounts useWorkspaceSync or useClipboardSync', () => {
    const src = readFileSync(join(__dirname, '../../src/renderer/components/SymbolChartWindow.tsx'), 'utf8')
    // Strip // lines first: the file's own comment names both hooks in prose.
    const code = src.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/useWorkspaceSync|useClipboardSync/)
  })
})
