import { describe, it, expect, afterEach, vi } from 'vitest'
import { startMcpHttpServer, type McpHttpServer } from '../../../src/main/mcp/httpServer'

// McpHttpServer only exposes port()/close(), so the underlying net.Server is captured via a
// wrapped `http.createServer` instead of widening the public API just for one test.
const capture = vi.hoisted(() => ({ server: undefined as import('http').Server | undefined }))
vi.mock('http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('http')>()
  return {
    ...actual,
    createServer: (...args: Parameters<typeof actual.createServer>) => {
      capture.server = actual.createServer(...args)
      return capture.server
    }
  }
})

let server: McpHttpServer | null = null

afterEach(async () => {
  await server?.close()
  server = null
})

const post = (port: number, headers: Record<string, string>, body: unknown = { jsonrpc: '2.0', id: 1, method: 'ping' }) =>
  fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })

describe('startMcpHttpServer', () => {
  it('passes an authorised request to the handler with the parsed body', async () => {
    const handle = vi.fn(async (_req, res, _body) => { res.writeHead(200).end('ok') })
    server = await startMcpHttpServer({ port: 0, token: 'secret', handle })

    const res = await post(server.port(), { authorization: 'Bearer secret' })

    expect(res.status).toBe(200)
    expect(handle).toHaveBeenCalledOnce()
    expect(handle.mock.calls[0][2]).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping' })
  })

  it('rejects a request with no token', async () => {
    const handle = vi.fn()
    server = await startMcpHttpServer({ port: 0, token: 'secret', handle })

    expect((await post(server.port(), {})).status).toBe(401)
    expect(handle).not.toHaveBeenCalled()
  })

  it('rejects a wrong token', async () => {
    const handle = vi.fn()
    server = await startMcpHttpServer({ port: 0, token: 'secret', handle })

    expect((await post(server.port(), { authorization: 'Bearer nope' })).status).toBe(401)
    expect(handle).not.toHaveBeenCalled()
  })

  it('rejects a foreign Origin', async () => {
    const handle = vi.fn()
    server = await startMcpHttpServer({ port: 0, token: 'secret', handle })

    const res = await post(server.port(), { authorization: 'Bearer secret', origin: 'https://evil.example' })

    expect(res.status).toBe(403)
    expect(handle).not.toHaveBeenCalled()
  })

  it('accepts a loopback Origin on the bound port', async () => {
    const handle = vi.fn(async (_req, res) => { res.writeHead(200).end('ok') })
    server = await startMcpHttpServer({ port: 0, token: 'secret', handle })

    const res = await post(server.port(), { authorization: 'Bearer secret', origin: `http://127.0.0.1:${server.port()}` })

    expect(res.status).toBe(200)
  })

  it('404s a path other than /mcp', async () => {
    const handle = vi.fn()
    server = await startMcpHttpServer({ port: 0, token: 'secret', handle })

    const res = await fetch(`http://127.0.0.1:${server.port()}/other`, {
      method: 'POST', headers: { authorization: 'Bearer secret' }, body: '{}'
    })

    expect(res.status).toBe(404)
  })

  it('logs rather than throws on a post-listen server error (e.g. accept-path EMFILE)', async () => {
    server = await startMcpHttpServer({ port: 0, token: 'secret', handle: vi.fn() })
    expect(capture.server).toBeDefined()

    expect(() => capture.server!.emit('error', new Error('EMFILE, too many open files'))).not.toThrow()
  })

  it('rejects the second listener on a busy port instead of silently moving (M-07)', async () => {
    server = await startMcpHttpServer({ port: 0, token: 'secret', handle: vi.fn() })
    await expect(
      startMcpHttpServer({ port: server.port(), token: 'secret', handle: vi.fn() })
    ).rejects.toThrow()
  })
})
