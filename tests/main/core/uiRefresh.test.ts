import { describe, it, expect, vi, afterEach } from 'vitest'
import { createCore, type CoreDeps } from '../../../src/main/core'

afterEach(() => { vi.useRealTimers() })

function build(requestRefresh: CoreDeps['requestRefresh']) {
  const deps = {
    broadcast: vi.fn(),
    barStore: {} as CoreDeps['barStore'],
    profileStore: {} as CoreDeps['profileStore'],
    companyProfileStore: {} as CoreDeps['companyProfileStore'],
    workspaceStore: {} as CoreDeps['workspaceStore'],
    capabilityCache: {} as CoreDeps['capabilityCache'],
    keystore: {} as CoreDeps['keystore'],
    makeProvider: () => ({}) as ReturnType<CoreDeps['makeProvider']>,
    requestRefresh
  } as CoreDeps
  return createCore(deps)
}

describe('core.uiRefresh', () => {
  it('resolves with the counts the window reported', async () => {
    let sentId = -1
    const core = build((id) => { sentId = id; return true })
    const pending = core.uiRefresh.run()
    core.uiRefresh.settle({ requestId: sentId, refreshed: 4, failed: 1, busy: false })
    await expect(pending).resolves.toEqual({ ok: true, refreshed: 4, failed: 1, busy: false })
  })

  it('reports no-window when the request could not be sent', async () => {
    const core = build(() => false)
    await expect(core.uiRefresh.run()).resolves.toEqual({ ok: false, reason: 'no-window' })
  })

  it('times out after 60 seconds', async () => {
    vi.useFakeTimers()
    const core = build(() => true)
    const pending = core.uiRefresh.run()
    vi.advanceTimersByTime(60_000)
    await expect(pending).resolves.toEqual({ ok: false, reason: 'timeout' })
  })

  // A late reply for a discarded request must not resolve or crash anything.
  it('ignores a settle for an unknown request id', async () => {
    const core = build(() => true)
    expect(() => core.uiRefresh.settle({ requestId: 999, refreshed: 1, failed: 0, busy: false })).not.toThrow()
  })

  it('gives each run a distinct request id', async () => {
    const ids: number[] = []
    const core = build((id) => { ids.push(id); return true })
    void core.uiRefresh.run()
    void core.uiRefresh.run()
    expect(new Set(ids).size).toBe(2)
  })
})
