import React, { useEffect, useState } from 'react'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/api'
import type { McpConfigView, McpStatus } from '@shared/ipc'

export function McpSetting(): React.JSX.Element {
  const [config, setConfig] = useState<McpConfigView | null>(null)
  const [status, setStatus] = useState<McpStatus>({ running: false })
  const [port, setPort] = useState('')
  // 生トークンは生成した直後だけ表示する。Radix Dialog は閉じると中身をアンマウントするので
  // (dialog.tsx に forceMount なし)、ダイアログを閉じ直すだけでこの state は消えマスクに戻る。
  const [rawToken, setRawToken] = useState<string | null>(null)
  // IPC round-trip is not instantaneous — disable while in flight so a double-click can't fire a
  // second overlapping call. Token generation especially: two mints would reveal one token and
  // leave the server honouring the other.
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.mcp.getConfig().then((c) => {
      setConfig(c)
      setPort(String(c.port))
    })
    void api.mcp.getStatus().then(setStatus)
    // A start failure (port already in use) is delivered asynchronously from main.
    return api.mcp.onStatusChanged((s) => {
      setStatus(s)
      if (s.error) toast.error(`Failed to start the MCP server: ${s.error}`)
    })
  }, [])

  if (!config) return <div className="text-sm font-medium">MCP server</div>

  const hasToken = config.maskedToken.length > 0

  const toggle = async (on: boolean): Promise<void> => {
    setBusy(true)
    setConfig({ ...config, enabled: on })
    try {
      setStatus(await api.mcp.setEnabled(on))
    } finally {
      setBusy(false)
    }
  }

  const savePort = async (): Promise<void> => {
    const parsed = Number(port)
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
      toast.error('Port must be an integer between 1024 and 65535.')
      return
    }
    setBusy(true)
    setConfig({ ...config, port: parsed })
    try {
      setStatus(await api.mcp.setPort(parsed))
    } finally {
      setBusy(false)
    }
  }

  const generate = async (): Promise<void> => {
    if (hasToken && !confirm('Generate a new token? Clients registered with the current token will stop working.')) return
    setBusy(true)
    try {
      const { config: next, token } = await api.mcp.generateToken()
      setConfig(next)
      setRawToken(token)
      toast.success('Token generated. Copy it now — it is shown only once.')
    } finally {
      setBusy(false)
    }
  }

  const copyToken = async (): Promise<void> => {
    if (!rawToken) return
    await navigator.clipboard.writeText(rawToken)
    toast.success('Token copied')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium">MCP server</div>
      <div className="text-xs text-muted-foreground">
        Listens on 127.0.0.1 only and requires a Bearer token. Responds only while the app is running.
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={config.enabled}
          className="inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-input transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 aria-checked:bg-primary"
          onClick={() => void toggle(!config.enabled)}
          disabled={busy || !hasToken}
          aria-label="Enable MCP server"
        >
          <span className="pointer-events-none ml-0.5 size-4 rounded-full bg-background shadow transition-transform data-[on=true]:translate-x-4" data-on={config.enabled} />
        </button>
        <span className="text-xs text-muted-foreground">
          {!hasToken
            ? 'Generate a token to enable.'
            : status.running
              ? `Running — http://127.0.0.1:${config.port}/mcp`
              : status.error
                ? `Stopped (${status.error})`
                : 'Stopped'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <code className="truncate font-mono text-xs text-muted-foreground">
            {rawToken ?? (hasToken ? config.maskedToken : 'Not generated')}
          </code>
          {/* コピーできるのは生表示のときだけ。マスク済みの値をコピーさせても意味がない。 */}
          {rawToken && (
            <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={copyToken} aria-label="Copy token">
              <Copy className="size-3.5" />
            </Button>
          )}
        </span>
        <Button variant="secondary" onClick={generate} disabled={busy}>
          Generate token
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Input className="w-32" value={port} onChange={(e) => setPort(e.target.value)} aria-label="Port" disabled={busy} />
        <Button variant="secondary" onClick={savePort} disabled={busy}>
          Save port
        </Button>
      </div>
    </div>
  )
}
