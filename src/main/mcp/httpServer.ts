import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { tokenMatches, originAllowed } from './auth'

export type McpRequestHandler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void>
export type McpHttpServer = { close(): Promise<void>; port(): number }

const PATH = '/mcp'
const MAX_BODY_BYTES = 4 * 1024 * 1024

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.length === 0) return resolve(undefined)
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
  })
}

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
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== PATH) return send(res, 404, 'not found')

        const address = server.address()
        const boundPort = typeof address === 'object' && address ? address.port : opts.port
        if (!originAllowed(req.headers.origin, boundPort)) return send(res, 403, 'origin not allowed')
        if (!tokenMatches(req.headers.authorization, opts.token)) return send(res, 401, 'unauthorized')

        const body = req.method === 'POST' ? await readBody(req) : undefined
        await opts.handle(req, res, body)
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
      const port = typeof address === 'object' && address ? address.port : opts.port
      resolve({
        port: () => port,
        close: () => new Promise<void>((done) => { server.close(() => done()) })
      })
    })
  })
}
