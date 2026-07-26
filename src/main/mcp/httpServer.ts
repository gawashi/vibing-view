import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { tokenMatches, originAllowed } from './auth'

export type McpRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>
export type McpHttpServer = { close(): Promise<void>; port(): number }

const PATH = '/mcp'

const send = (res: ServerResponse, status: number, message: string): void => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: message }))
}

// Bound to 127.0.0.1 only. No automatic port fallback: if the port is taken, fail loudly so the
// configured port and the running one can never disagree (M-07).
export function startMcpHttpServer(opts: {
  port: number
  token: string
  handle: McpRequestHandler
}): Promise<McpHttpServer> {
  // Only differs from opts.port when a test passes 0 ("any free port"); assigned once, on listen.
  let boundPort = opts.port
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== PATH) return send(res, 404, 'not found')
        if (!originAllowed(req.headers.origin, boundPort)) return send(res, 403, 'origin not allowed')
        if (!tokenMatches(req.headers.authorization, opts.token)) return send(res, 401, 'unauthorized')

        // The body is left unread: the MCP transport parses it itself (and answers a bad one with
        // a JSON-RPC -32700) — see webStandardStreamableHttp's `req.json()` fallback.
        await opts.handle(req, res)
      } catch (err) {
        if (!res.headersSent) send(res, 400, err instanceof Error ? err.message : 'bad request')
        else res.end()
      }
    })()
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port, '127.0.0.1', () => {
      server.removeListener('error', reject)
      // Post-listen errors (e.g. EMFILE on the accept path) must not crash the app: an
      // 'error' event with no listener throws. Log instead of leaving the emitter bare.
      server.on('error', (err) => console.error('[mcp] http server error:', err))
      const address = server.address()
      if (typeof address === 'object' && address) boundPort = address.port
      resolve({
        port: () => boundPort,
        // server.close()'s callback only fires once every open socket ends on its own — a
        // keep-alive connection can hold it open indefinitely, and applyConfig awaits this before
        // rebinding the port. Stop accepting first, then force-close what's already open.
        close: () => new Promise<void>((done) => {
          server.close(() => done())
          server.closeAllConnections()
        })
      })
    })
  })
}
