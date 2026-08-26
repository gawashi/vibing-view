import React, { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChartLine, PanelLeftClose, PanelLeftOpen, RefreshCw, Timer, TimerOff, TrendingUp } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, qk } from './api'
import { Button } from './components/ui/button'
import { GridHost } from './components/GridHost'
import { GridShapePicker } from './components/GridShapePicker'
import { ApplyToAllToolbar } from './components/ApplyToAllToolbar'
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher'
import { quoteSymbols } from './lib/quoteTargets'
import { refreshTargets } from './lib/refreshTargets'
import { cn } from './lib/utils'
import { SearchBar } from './components/SearchBar'
import { SettingsDialog } from './components/SettingsDialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip'
import { Toaster } from './components/ui/sonner'
import { Watchlist } from './components/Watchlist'
import { useAppStore, selectActiveItems } from './store'
import { useWorkspaceSync } from './hooks/useWorkspaceSync'
import { useClipboardSync } from './hooks/useClipboardSync'
import { useGridShortcuts } from '@/hooks/useGridShortcuts'
import { applyTheme } from './lib/theme'
import type { CapabilityStatus, RefreshDonePayload } from '@shared/ipc'
import type { Timeframe, Quote, MarketStatus } from '@shared/types'
import type { ReloadSource } from './lib/autoRefresh'

export default function App(): React.JSX.Element {
  // Sidebar open/closed (D-63) — UI chrome, persisted separately from the Workspace/named-layout
  // model via settings.json (see api.settings.get/setSidebarOpen), NOT via layout.setCurrent.
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // auto tick の reload closure は effect 生成時の値を握るので、最新の sidebarOpen を ref 経由で読む
  // (cells/shape を useAppStore.getState() で読むのと同じ思想)。これがないと開閉後に古い可視状態で走る。
  const sidebarOpenRef = useRef(sidebarOpen)
  sidebarOpenRef.current = sidebarOpen
  const [sidebarWidth, setSidebarWidth] = useState(240)

  useWorkspaceSync()
  useClipboardSync()

  useEffect(() => {
    void api.settings.getTheme().then(applyTheme)
    void api.settings.getSidebarOpen().then((open) => {
      if (open !== null) setSidebarOpen(open)
    })
    void api.settings.getSidebarWidth().then((w) => {
      if (w !== null) setSidebarWidth(w)
    })
    void api.settings.getAutoRefresh().then(setAutoRefresh)
  }, [])

  // ponytail: React-state (not a store subscribe) so a plain 500ms debounced effect is enough.
  // The one redundant write of the default 240 on first mount (before load resolves) is harmless.
  useEffect(() => {
    const t = setTimeout(() => { void api.settings.setSidebarWidth(sidebarWidth) }, 500)
    return () => clearTimeout(t)
  }, [sidebarWidth])

  const toggleSidebar = (): void => {
    setSidebarOpen((prev) => {
      const next = !prev
      void api.settings.setSidebarOpen(next)
      return next
    })
  }

  const queryClient = useQueryClient()
  const [reloading, setReloading] = useState(false)
  const inFlight = useRef(false)
  // 2軸を分離: status=市場/スケジューラ状態(ドット), errorSource=どのリロードが失敗したか(アイコン)。
  // これで「閉鎖中の手動成功で緑になる」も「auto の失敗が手動ボタンを赤くする」も起きない。
  const [refreshState, setRefreshState] = useState<{
    status: 'idle' | 'ok' | 'paused-closed'
    errorSource: ReloadSource | null
    lastRefreshedAt: number | null
  }>({ status: 'idle', errorSource: null, lastRefreshedAt: null })
  const [autoRefresh, setAutoRefresh] = useState(false)

  // 戻り値は force_reload への返答そのもの（MW-14）。
  const reload = async (
    opts: { source: ReloadSource }
  ): Promise<Omit<RefreshDonePayload, 'requestId'>> => {
    // 同期ガード: 手動と auto tick の二重実行を防ぐ（state のラグに依存しない）。
    // MW-14: 黙って捨てず busy を返す — MCP の force_reload はこの戻り値で「今は無理」を知る。
    if (inFlight.current) return { refreshed: 0, failed: 0, busy: true }
    const state = useAppStore.getState()
    const { cells, shape } = state
    const caps = queryClient.getQueryData<Record<Timeframe, CapabilityStatus>>(qk.capabilities())
    const watchlistSymbols = sidebarOpenRef.current ? selectActiveItems(state).map((w) => w.symbol) : []
    const targets = refreshTargets(cells, shape, caps, watchlistSymbols)

    inFlight.current = true
    setReloading(true)
    try {
      // market status を先に取得。auto はクローズ中フェッチを打ち切る（API 節約）。
      // statusOk で「取得成功して閉場」と「回線エラーで不明」を区別する（後者は auto 失敗として赤に）。
      let isOpen = false
      let statusOk = false
      try {
        const status = await api.market.status()
        queryClient.setQueryData(qk.marketStatus(), status)
        isOpen = status.isOpen
        statusOk = true
      } catch {
        // status 不明 → 手動は続行、auto は closed 扱いで下の判定によりスキップ。
      }
      // 手動は常に進む（クローズ後の確定日足を取りに行く）。auto はクローズ中は進まない（API 節約）。
      if (opts.source === 'auto' && !isOpen) {
        // クローズで打ち切る場合も、取得済みの market-status だけは他ウィンドウへ配る（追加 FMP なし）。
        // これがないと enlarge 窓がクローズ後も古い open 状態のまま取り残される。
        const marketStatus = queryClient.getQueryData<MarketStatus>(qk.marketStatus()) ?? null
        void api.refresh.broadcast({ ohlcv: [], quotes: [], marketStatus })
        // 状態取得成功なら通常の閉場ポーズ(琥珀・エラー無し)。回線エラー(statusOk=false)なら
        // 閉場と丸めず市場状態は据え置き、auto 失敗として ⏱ を赤くする。
        setRefreshState((s) => ({
          ...s,
          status: statusOk ? 'paused-closed' : s.status,
          errorSource: statusOk ? null : 'auto',
        }))
        return { refreshed: 0, failed: 0, busy: false }
      }
      let marketStatus: MarketStatus | null = queryClient.getQueryData<MarketStatus>(qk.marketStatus()) ?? null
      const ohlcvResults = await Promise.allSettled(
        targets.map(async (t) => {
          const bars = await api.ohlcv.refresh(t.symbol, t.timeframe)
          queryClient.setQueryData(qk.ohlcv(t.symbol, t.timeframe), bars)
          return { symbol: t.symbol, timeframe: t.timeframe, bars }
        })
      )
      const ohlcv = ohlcvResults.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
      // Capability verdicts may have changed (a refresh re-probes the fetched tf); re-gate the row.
      void queryClient.invalidateQueries({ queryKey: qk.capabilities() })
      const quotes: { symbol: string; quote: Quote }[] = []
      if (isOpen) {
        const syms = quoteSymbols(cells, shape, watchlistSymbols)
        const quoteResults = await Promise.allSettled(
          syms.map(async (s) => {
            const quote = await api.quote.get(s)
            queryClient.setQueryData(qk.quote(s), quote)
            return { symbol: s, quote }
          })
        )
        for (const r of quoteResults) if (r.status === 'fulfilled') quotes.push(r.value)
      }
      // 他ウィンドウ(enlarge 窓)へ配信。受信側は setQueryData のみ（追加 FMP なし）。
      void api.refresh.broadcast({ ohlcv, quotes, marketStatus })
      // ohlcv は fulfilled のみ（上の flatMap）なので、それが成功数そのもの。
      const failedCount = ohlcvResults.length - ohlcv.length
      const failed = failedCount > 0
      if (failed) toast('Some charts couldn’t be refreshed. Check your connection or FMP plan.')
      // ドットは市場状態(開場=緑/閉鎖=琥珀)。失敗は起こしたソースを errorSource に記録し、
      // 成功はソースに関わらずクリア(データが最新になったので)。
      // status 取得失敗(statusOk=false)時は市場状態が不明なので閉場と丸めず据え置き、
      // 取得失敗自体を errorSource に記録する(上の閉場スキップ分岐と同じ扱い)。
      setRefreshState((s) => ({
        status: statusOk ? (isOpen ? 'ok' : 'paused-closed') : s.status,
        errorSource: failed || !statusOk ? opts.source : null,
        lastRefreshedAt: Date.now(),
      }))
      return { refreshed: ohlcv.length, failed: failedCount, busy: false }
    } finally {
      inFlight.current = false
      setReloading(false)
    }
  }

  const toggleAutoRefresh = (): void => {
    setAutoRefresh((prev) => {
      const next = !prev
      void api.settings.setAutoRefresh(next)
      return next
    })
  }

  // 集中スケジューラ: タイマーはメインウィンドウ（App）にのみ存在する。ON で即 1 回 + 毎分。
  // 非表示中(document.hidden)は tick をスキップし API を消費しない。再表示で 1 回更新。
  useEffect(() => {
    if (!autoRefresh) return
    const tick = (): void => {
      if (document.hidden) return
      void reload({ source: 'auto' })
    }
    tick() // ON にした瞬間に即 1 回
    const id = setInterval(tick, 60_000)
    const onVisible = (): void => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh])

  useGridShortcuts(() => void reload({ source: 'manual' }))

  // MCP の force_reload はこの購読で UI のリロードボタンと同じ経路を通る（MW-14）。
  // reload はレンダごとに作り直されるが、参照するのは ref と getState だけなので初回分で足りる。
  useEffect(() => api.refresh.onRequest((requestId) => {
    void reload({ source: 'manual' }).then((r) => api.refresh.done({ requestId, ...r }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  // Per-cell capability gating (eager intraday probe, requires-plan→snap-to-daily, rate-limit
  // toast) has moved into GridHost's GridCell (D-60) — each rendered cell now gates its own row off
  // its own symbol/timeframe instead of one App-level effect tied to a single active symbol.

  const AutoIcon = autoRefresh ? Timer : TimerOff
  // ドット=市場状態のみ。失敗はドットではなく、失敗したリロードのアイコン(下)で赤表示する。
  const statusMeta = {
    idle: { dot: 'bg-muted-foreground/40', text: 'Not refreshed yet' },
    ok: {
      dot: 'bg-green-500',
      text: refreshState.lastRefreshedAt
        ? `Market open — updated ${new Date(refreshState.lastRefreshedAt).toLocaleTimeString()}`
        : 'Market open',
    },
    'paused-closed': { dot: 'bg-amber-500', text: 'Market closed — auto-refresh paused' },
  }[refreshState.status]

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <header className="flex items-center gap-4 border-b border-border bg-card px-8 py-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                aria-label={sidebarOpen ? 'Hide watchlist' : 'Show watchlist'}
              >
                {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{sidebarOpen ? 'Hide watchlist' : 'Show watchlist'}</TooltipContent>
          </Tooltip>
          <GridShapePicker />
          <ApplyToAllToolbar />
          <WorkspaceSwitcher />
          <div className="ml-auto flex items-center gap-4">
            {/* Reload + auto-refresh を1枠に連結。ステータスは固定幅の色ドットで表し、
                可変長の "Updated HH:MM:SS" 等はツールチップへ退避してヘッダーの幅ズレを防ぐ。 */}
            <div className="flex items-center rounded-md border border-border">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-r-none"
                    onClick={() => void reload({ source: 'manual' })}
                    disabled={reloading}
                    aria-label="Reload visible charts"
                  >
                    <RefreshCw
                      className={cn(
                        'size-4',
                        reloading && 'animate-spin',
                        refreshState.errorSource === 'manual' && 'text-destructive',
                      )}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {refreshState.errorSource === 'manual'
                    ? 'Reload failed — click to retry'
                    : 'Reload visible charts'}
                </TooltipContent>
              </Tooltip>
              <div className="h-6 w-px bg-border" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 rounded-l-none"
                    onClick={toggleAutoRefresh}
                    aria-label={autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
                  >
                    <AutoIcon className={cn('size-4', refreshState.errorSource === 'auto' && 'text-destructive')} />
                    <span className="text-xs tabular-nums">{autoRefresh ? '1m' : 'Off'}</span>
                    <span className={cn('size-2 rounded-full', statusMeta.dot)} aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {(autoRefresh ? 'Auto-refresh: every 1 min' : 'Auto-refresh: off') +
                    ` — ${statusMeta.text}` +
                    (refreshState.errorSource === 'auto' ? ' (last auto-refresh failed)' : '')}
                </TooltipContent>
              </Tooltip>
            </div>
            <SearchBar />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void api.economic.openWindow()}
                  aria-label="Economic calendar"
                >
                  <CalendarDays className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Economic calendar</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  // 名前を渡さない: main は選択中の指標をプロセス内に持ち続けるので、直前に選んだ指標
                  // のまま開く（既定の CPI に戻すのは、まだ何も選ばれていないときだけ、窓側で行う）。
                  onClick={() => void api.economicIndicator.openWindow()}
                  aria-label="Economic indicators"
                  title="Economic indicators"
                >
                  <ChartLine className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Economic indicators</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void api.yieldCurve.openWindow()}
                  aria-label="Yield curve"
                  title="Yield curve"
                >
                  <TrendingUp className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Yield curve</TooltipContent>
            </Tooltip>
            <SettingsDialog />
          </div>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <Watchlist open={sidebarOpen} width={sidebarWidth} onWidthChange={setSidebarWidth} />
          <main className="flex-1 overflow-hidden">
            <GridHost />
          </main>
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  )
}
