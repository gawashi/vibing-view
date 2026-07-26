import { describe, it, expect, vi } from 'vitest'
import { buildTools, type ToolCore } from '../../../src/main/mcp/tools'

const NOW = Date.parse('2026-07-26T00:00:00Z')

function fakeCore(run: ToolCore['uiRefresh']['run']): ToolCore {
  return {
    ohlcv: { get: vi.fn(), refresh: vi.fn() },
    symbols: { search: vi.fn(), profile: vi.fn() },
    quote: { get: vi.fn() },
    company: { info: vi.fn() },
    workspaces: { get: vi.fn(), set: vi.fn(), mutate: vi.fn() },
    capabilities: { get: vi.fn() },
    cacheStatus: { summarize: vi.fn(() => []) },
    uiRefresh: { run, settle: vi.fn() }
  } as unknown as ToolCore
}

const tool = (core: ToolCore) => {
  const def = buildTools(core, () => NOW).find((t) => t.name === 'force_reload')
  if (!def) throw new Error('no tool named force_reload')
  return def
}

describe('force_reload', () => {
  it('reports the counts the window returned', async () => {
    const core = fakeCore(async () => ({ ok: true, refreshed: 4, failed: 1, busy: false }))
    const res = await tool(core).handler({})
    expect(res.isError).toBeUndefined()
    expect(res.content[0].text).toBe('Refreshed 4 charts, 1 failed.')
  })

  it('uses the singular for one chart and omits the failure clause at zero', async () => {
    const core = fakeCore(async () => ({ ok: true, refreshed: 1, failed: 0, busy: false }))
    const res = await tool(core).handler({})
    expect(res.content[0].text).toBe('Refreshed 1 chart.')
  })

  it('maps busy to a retryable message', async () => {
    const core = fakeCore(async () => ({ ok: true, refreshed: 0, failed: 0, busy: true }))
    const res = await tool(core).handler({})
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('A refresh is already in progress in the app.')
  })

  it('maps a missing window', async () => {
    const core = fakeCore(async () => ({ ok: false, reason: 'no-window' }))
    const res = await tool(core).handler({})
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('The app window is not available.')
  })

  it('maps a timeout', async () => {
    const core = fakeCore(async () => ({ ok: false, reason: 'timeout' }))
    const res = await tool(core).handler({})
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toBe('Refresh timed out — it may still be running in the app.')
  })
})
