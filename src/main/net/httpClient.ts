import { net, session } from 'electron'
import { FmpHttpError, type HttpGetJson } from '../providers/FmpProvider'

// Main-process HTTP client for the data provider.
//
// We route provider requests through Electron's `net` module (Chromium's network stack) instead
// of Node's global `fetch` (undici). This matters on corporate networks (the primary deploy
// target): undici's global fetch ignores the system proxy AND the HTTP(S)_PROXY environment
// variables entirely, so on a locked-down LAN it tries a direct egress that the firewall drops,
// surfacing as `UND_ERR_CONNECT_TIMEOUT`. Chromium's stack, by contrast, honors the OS proxy
// (Internet Options / PAC / WPAD) and the OS trust store — so corporate TLS-inspection proxies
// work without cert errors. This module is deliberately kept out of FmpProvider.ts so that file
// stays `electron`-free and unit-testable under Node.

// Resolve the proxy Chromium should use, applied to the default session at startup.
//   - HTTPS_PROXY/HTTP_PROXY set (e.g. a dev shell) → use it, honoring NO_PROXY as bypass rules.
//   - Otherwise → 'system': follow the OS proxy configuration (what packaged corporate installs use).
export async function configureProxy(sess = session.defaultSession): Promise<void> {
  const proxyUrl =
    process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy
  if (proxyUrl) {
    const proxyBypassRules = (process.env.NO_PROXY ?? process.env.no_proxy)?.trim() || undefined
    await sess.setProxy({ proxyRules: proxyUrl, proxyBypassRules })
  } else {
    await sess.setProxy({ mode: 'system' })
  }
}

// Same contract as FmpProvider.defaultHttpGetJson (parse-or-throw-FmpHttpError), backed by
// Chromium's fetch. `net.fetch` is fetch-compatible and must be called after `app` is ready.
export const electronHttpGetJson: HttpGetJson = async (url) => {
  const res = await net.fetch(url)
  if (!res.ok) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      // non-JSON error body — leave body null, status alone is still classifiable
    }
    throw new FmpHttpError(res.status, body)
  }
  return res.json()
}
