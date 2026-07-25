import { describe, it, expect, vi, beforeEach } from 'vitest'

// startMcpHttpServer is mocked so this test never touches a real socket — it only needs to prove
// that applyConfig()/stop() calls are serialised, not that the HTTP server itself works.
const listen = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/mcp/httpServer', () => ({ startMcpHttpServer: listen }))
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({ McpServer: vi.fn() }))
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({ StreamableHTTPServerTransport: vi.fn() }))

import { applyConfig, getStatus } from '../../../src/main/mcp'
import type { ToolCore } from '../../../src/main/mcp/tools'

const core = {} as ToolCore
const config = (enabled: boolean) => ({ enabled, port: 4123, token: 't' })

describe('applyConfig serialisation', () => {
  beforeEach(() => {
    listen.mockReset()
  })

  it('never leaves a live listener when two calls race (start then immediate stop)', async () => {
    let resolveListen: (v: unknown) => void = () => {}
    const server = { close: vi.fn(async () => {}), port: () => 4123, address: () => '127.0.0.1' }
    listen.mockImplementationOnce(() => new Promise((resolve) => { resolveListen = resolve }))

    // Call A starts the server but its `listen` has not resolved yet.
    const a = applyConfig(core, config(true))
    // Call B disables before A's listen settles.
    const b = applyConfig(core, config(false))
    // `listen` is only invoked once A's queued turn actually runs (a microtask later) — wait for
    // that before resolving it, or resolveListen would still be the pre-assigned no-op.
    await vi.waitFor(() => expect(listen).toHaveBeenCalledTimes(1))
    resolveListen(server)

    await Promise.all([a, b])

    // B must run after A's listener is actually up, so it can close it — never left running.
    expect(server.close).toHaveBeenCalled()
    expect(getStatus().running).toBe(false)
  })

  it('a rejected call does not wedge the chain for later calls', async () => {
    listen.mockImplementationOnce(async () => { throw new Error('EADDRINUSE') })
    await applyConfig(core, config(true)) // fails, caught internally as lastError — must not throw

    const server = { close: vi.fn(async () => {}), port: () => 4123, address: () => '127.0.0.1' }
    listen.mockImplementationOnce(async () => server)
    const status = await applyConfig(core, config(true))

    expect(status.running).toBe(true)
  })
})
