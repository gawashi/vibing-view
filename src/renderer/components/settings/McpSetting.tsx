import React, { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/api'
import type { McpConfig, McpStatus } from '@shared/ipc'

// 貼り付け用の設定 JSON。Claude Code は `claude mcp add --transport http` でも登録できる。
function clientConfig(config: McpConfig): string {
  return JSON.stringify(
    {
      mcpServers: {
        'vibing-view': {
          type: 'http',
          url: `http://127.0.0.1:${config.port}/mcp`,
          headers: { Authorization: `Bearer ${config.token}` }
        }
      }
    },
    null,
    2
  )
}

export function McpSetting(): React.JSX.Element {
  const [config, setConfig] = useState<McpConfig | null>(null)
  const [status, setStatus] = useState<McpStatus>({ running: false })
  const [port, setPort] = useState('')
  // IPC round-trip is not instantaneous — disable while in flight so a double-click can't fire a
  // second overlapping call (the main process serialises them anyway, but there's no reason to
  // let the UI even try).
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.mcp.getConfig().then((c) => {
      setConfig(c)
      setPort(String(c.port))
    })
    void api.mcp.getStatus().then(setStatus)
    // 起動失敗(ポート衝突など)は main から届く。
    return api.mcp.onStatusChanged((s) => {
      setStatus(s)
      if (s.error) toast.error(`MCP サーバを起動できませんでした: ${s.error}`)
    })
  }, [])

  if (!config) return <div className="text-sm font-medium">MCP サーバ</div>

  const toggle = async (): Promise<void> => {
    const next = !config.enabled
    setBusy(true)
    setConfig({ ...config, enabled: next })
    try {
      setStatus(await api.mcp.setEnabled(next))
    } finally {
      setBusy(false)
    }
  }

  const savePort = async (): Promise<void> => {
    const parsed = Number(port)
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
      toast.error('ポートは 1024〜65535 の整数で指定してください')
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

  const regenerate = async (): Promise<void> => {
    if (!confirm('トークンを再生成しますか？ 登録済みのクライアント設定を貼り直す必要があります。')) return
    setConfig(await api.mcp.regenerateToken())
    toast.success('トークンを再生成しました')
  }

  const copyConfig = async (): Promise<void> => {
    await navigator.clipboard.writeText(clientConfig(config))
    toast.success('設定 JSON をコピーしました')
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium">MCP サーバ</div>
      <div className="text-xs text-muted-foreground">
        Claude Desktop / Claude Code からキャッシュ済みの価格データとワークスペースを読めるようにします。
        127.0.0.1 のみで待ち受け、Bearer トークンが必要です。アプリの起動中だけ応答します。
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={toggle} disabled={busy}>{config.enabled ? '停止する' : '有効にする'}</Button>
        <span className="text-xs text-muted-foreground">
          {status.running
            ? `起動中 — http://127.0.0.1:${config.port}/mcp`
            : status.error
              ? `停止中（${status.error}）`
              : '停止中'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Input className="w-32" value={port} onChange={(e) => setPort(e.target.value)} aria-label="ポート" disabled={busy} />
        <Button variant="secondary" onClick={savePort} disabled={busy}>
          ポートを保存
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={copyConfig}>
          設定 JSON をコピー
        </Button>
        <Button variant="secondary" onClick={regenerate}>
          トークンを再生成
        </Button>
      </div>
    </div>
  )
}
