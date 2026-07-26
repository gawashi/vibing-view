import { describe, it, expect, afterEach } from 'vitest'
import { applyConfig } from '../../../src/main/mcp'
import type { ToolCore } from '../../../src/main/mcp/tools'

// The only test that runs the real HTTP server, the real SDK transport, and a real POST: httpServer
// deliberately leaves the request body unread so the transport can parse it. Nothing else would
// notice if that contract broke.
const core = {
  workspaces: { get: () => ({ collection: { version: 3, active: 'Main', workspaces: [] }, rev: 0 }) }
} as unknown as ToolCore

const PORT = 39177

afterEach(async () => {
  await applyConfig(core, { enabled: false, port: PORT, token: 't' })
})

describe('mcp round trip', () => {
  it('answers tools/list over HTTP', async () => {
    expect(await applyConfig(core, { enabled: true, port: PORT, token: 'secret' })).toEqual({ running: true })

    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      'search_symbols', 'get_ohlcv', 'get_quote', 'get_company_info',
      'get_workspaces', 'get_workspace', 'get_cache_status'
    ])
  })

  it('calls a tool with arguments', async () => {
    await applyConfig(core, { enabled: true, port: PORT, token: 'secret' })

    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'get_workspace', arguments: { name: 'Nope' } }
      })
    })

    const body = await res.json()
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toBe('No workspace named "Nope". Available: ')
  })
})
