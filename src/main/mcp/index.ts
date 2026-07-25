import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpConfig, McpStatus } from '@shared/ipc'
import { startMcpHttpServer, type McpHttpServer } from './httpServer'
import { registerTools, type ToolCore } from './tools'

let running: McpHttpServer | null = null
let lastError: string | undefined
let notify: ((s: McpStatus) => void) | null = null

export function getStatus(): McpStatus {
  return running ? { running: true } : { running: false, ...(lastError ? { error: lastError } : {}) }
}

export function onStatusChanged(cb: (s: McpStatus) => void): void {
  notify = cb
}

// Serialises stop()/applyConfig() so two overlapping calls (e.g. a Settings toggle double-click)
// can never interleave — without this, call A could await `listen` after call B already decided
// there was nothing to stop, leaving a live listener while the UI and settings.json both say
// stopped. `fn, fn` runs `fn` on rejection too, so one failed call can't wedge the chain forever.
let chain: Promise<unknown> = Promise.resolve()
const serial = <T>(fn: () => Promise<T>): Promise<T> => (chain = chain.then(fn, fn) as Promise<T>)

async function stopNow(): Promise<void> {
  await running?.close()
  running = null
}

export function stop(): Promise<void> {
  return serial(stopNow)
}

async function applyConfigNow(core: ToolCore, config: McpConfig): Promise<McpStatus> {
  await stopNow()
  lastError = undefined
  if (config.enabled && !config.token) {
    // A listener with no token accepts nobody (auth.ts rejects an empty stored token for every
    // request), so bringing it up would only occupy the port and claim to be running. Covers a
    // hand-edited settings.json with enabled:true too.
    lastError = 'No token generated yet.'
  } else if (config.enabled) {
    try {
      running = await startMcpHttpServer({
        port: config.port,
        token: config.token,
        // Stateless: a fresh server + transport per request. The SDK's own stateless example does
        // the same — reusing one transport across concurrent requests collides on JSON-RPC ids.
        // Building them is just object construction plus our tool registrations.
        handle: async (req, res, body) => {
          const server = new McpServer({ name: 'vibing-view', version: '0.2.0' })
          registerTools(server, core)
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true
          })
          res.on('close', () => {
            void transport.close()
            void server.close()
          })
          await server.connect(transport)
          await transport.handleRequest(req, res, body)
        }
      })
    } catch (err) {
      // Port already taken is the common case. Surface it instead of shifting the port silently,
      // which would leave the settings dialog describing a URL nothing is listening on (M-07).
      lastError = err instanceof Error ? err.message : String(err)
    }
  }
  const status = getStatus()
  notify?.(status)
  return status
}

export function applyConfig(core: ToolCore, config: McpConfig): Promise<McpStatus> {
  return serial(() => applyConfigNow(core, config))
}
