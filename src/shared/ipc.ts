import type { Bar, SymbolResult, Timeframe, DateRange, WorkspaceCollection, Quote, MarketStatus, CompanyInfo, ClipboardCell, EconomicFilterPref, EconomicRange } from './types'

export const CH = {
  symbolsSearch: 'symbols:search',
  symbolsProfile: 'symbols:profile',
  ohlcvGet: 'ohlcv:get',
  ohlcvRefresh: 'ohlcv:refresh',
  quoteGet: 'quote:get',
  marketStatus: 'market:status',
  apikeySet: 'apikey:set',
  apikeyStatus: 'apikey:status',
  apikeyClear: 'apikey:clear',
  settingsGetLastSymbol: 'settings:getLastSymbol',
  settingsSetLastSymbol: 'settings:setLastSymbol',
  settingsGetSidebarOpen: 'settings:getSidebarOpen',
  settingsSetSidebarOpen: 'settings:setSidebarOpen',
  settingsGetSidebarWidth: 'settings:getSidebarWidth',
  settingsSetSidebarWidth: 'settings:setSidebarWidth',
  settingsGetTheme: 'settings:getTheme',
  settingsSetTheme: 'settings:setTheme',
  settingsGetAutoRefresh: 'settings:getAutoRefresh',
  settingsSetAutoRefresh: 'settings:setAutoRefresh',
  settingsGetEconomicFilter: 'settings:getEconomicFilter',
  settingsSetEconomicFilter: 'settings:setEconomicFilter',
  capabilitiesGet: 'capabilities:get',
  workspacesGet: 'workspaces:get',
  workspacesSet: 'workspaces:set',
  companyInfo: 'company:info',
  companyOpenWindow: 'company:openWindow',
  economicCalendar: 'economic:calendar',
  economicOpenWindow: 'economic:openWindow',
  chartOpenWindow: 'chart:openWindow',
  symbolChartOpenWindow: 'symbolChart:openWindow',
  workspacesChanged: 'workspaces:changed',
  clipboardGet: 'clipboard:get',
  clipboardSet: 'clipboard:set',
  clipboardChanged: 'clipboard:changed',
  refreshBroadcast: 'refresh:broadcast',
  refreshApplied: 'refresh:applied',
  refreshRequest: 'refresh:request',
  refreshDone: 'refresh:done',
  mcpGetConfig: 'mcp:getConfig',
  mcpSetEnabled: 'mcp:setEnabled',
  mcpSetPort: 'mcp:setPort',
  mcpGenerateToken: 'mcp:generateToken',
  mcpGetStatus: 'mcp:getStatus',
  mcpStatusChanged: 'mcp:statusChanged'
} as const

export type KeyStatus = { hasKey: boolean; encryptionAvailable: boolean; maskedKey?: string }
export type SetKeyResult = { ok: boolean; encryptionAvailable: boolean }
export type CapabilityStatus = 'available' | 'requires-plan' | 'rate-limited' | 'unknown'
export type Theme = 'light' | 'dark' | 'system'
// MCP サーバ設定。main 内部専用の型で、生 token を持つ。token が '' なら未生成。
export type McpConfig = { enabled: boolean; port: number; token: string }
// renderer へ渡す形。生トークンは生成した瞬間の戻り値でしか渡さないので、ここはマスク済みだけ。
// maskedToken が '' なら未生成。
export type McpConfigView = { enabled: boolean; port: number; maskedToken: string }
export type McpStatus = { running: boolean; error?: string }
export type WorkspacesPayload = { collection: WorkspaceCollection; rev: number }
export type ClipboardPayload = { clipboard: ClipboardCell | null; rev: number }
export type RefreshAppliedPayload = {
  ohlcv: { symbol: string; timeframe: Timeframe; bars: Bar[] }[]
  quotes: { symbol: string; quote: Quote }[]
  marketStatus: MarketStatus | null
}
// force_reload の委譲（MW-14）。main → メインウィンドウが requestId を送り、window が終わったら
// 同じ id で件数を返す。busy は「別のリフレッシュが走っていたので何もしなかった」。
export type RefreshDonePayload = {
  requestId: number
  refreshed: number
  failed: number
  busy: boolean
}

export interface Api {
  symbols: {
    search(query: string): Promise<SymbolResult[]>
    profile(symbol: string): Promise<SymbolResult>
  }
  ohlcv: {
    get(symbol: string, timeframe: Timeframe, range: DateRange): Promise<Bar[]>
    // Reload: fetch only the new bars (cached newest → now) and return the merged series.
    refresh(symbol: string, timeframe: Timeframe): Promise<Bar[]>
  }
  quote: { get(symbol: string): Promise<Quote> }
  market: { status(): Promise<MarketStatus> }
  apikey: {
    set(key: string): Promise<SetKeyResult>
    status(): Promise<KeyStatus>
    clear(): Promise<void>
  }
  settings: {
    getLastSymbol(): Promise<string | null>
    setLastSymbol(symbol: string): Promise<void>
    // Sidebar open/closed flag (D-63) — persisted separately from Workspace/named layouts, since
    // it's UI chrome, not workspace config. Same small-JSON pattern as lastSymbol, same file.
    getSidebarOpen(): Promise<boolean | null>
    setSidebarOpen(open: boolean): Promise<void>
    getSidebarWidth(): Promise<number | null>
    setSidebarWidth(width: number): Promise<void>
    getTheme(): Promise<Theme>
    setTheme(theme: Theme): Promise<void>
    // 自動更新トグル（settings.json、既定 false）。sidebarOpen と同じ UI-chrome 永続化。
    getAutoRefresh(): Promise<boolean>
    setAutoRefresh(on: boolean): Promise<void>
    // 経済カレンダーの国/重要度フィルタ。テキストフィルタは永続化しない（EC-13）。
    getEconomicFilter(): Promise<EconomicFilterPref>
    setEconomicFilter(filter: EconomicFilterPref): Promise<void>
  }
  capabilities: { get(): Promise<Record<Timeframe, CapabilityStatus>> }
  workspaces: {
    // rev: monotonic version stamped by main. Renderers ignore any get/onChanged payload whose rev
    // is <= the last one they applied (drops out-of-order broadcasts and the startup get-vs-broadcast race).
    get(): Promise<WorkspacesPayload>
    set(c: WorkspaceCollection): Promise<void>
    onChanged(cb: (p: WorkspacesPayload) => void): () => void
  }
  // Chart clipboard: main holds the value + a monotonic rev; renderers ignore stale (<= lastRev)
  // payloads. Same ordering contract as workspaces so a window opened after a copy still sees it.
  clipboard: {
    get(): Promise<ClipboardPayload>
    set(c: ClipboardCell | null): Promise<number> // resolves to the authoritative rev main assigned
    onChanged(cb: (p: ClipboardPayload) => void): () => void
  }
  company: {
    info(symbol: string, opts?: { force?: boolean }): Promise<CompanyInfo>
    openWindow(symbol: string): Promise<void>
  }
  // 経済カレンダー。from/to は UTC 日の 'YYYY-MM-DD'（どの日が必要かは renderer が決める）。
  // ウィンドウは 1 枚だけなので openWindow は引数を取らない（EC-09）。
  economic: {
    getRange(from: string, to: string, opts?: { force?: boolean }): Promise<EconomicRange>
    openWindow(): Promise<void>
  }
  chart: {
    openWindow(cellId: string): Promise<void>
  }
  // ウォッチリスト銘柄の拡大窓（銘柄キー、使い捨て）。chart 窓と違いセルにもワークスペースにも
  // 紐づかないので、開くのに必要なのは symbol だけ。
  symbolChart: {
    openWindow(symbol: string): Promise<void>
  }
  // スケジューラ（メインウィンドウ）が取得済みデータを他ウィンドウへ配信。受信側は setQueryData
  // するだけで FMP を叩かない。workspaces と同じく main が送信元以外へ転送する。
  refresh: {
    broadcast(p: RefreshAppliedPayload): Promise<void>
    onApplied(cb: (p: RefreshAppliedPayload) => void): () => void
    // main（MCP の force_reload）からの実行依頼。メインウィンドウだけが購読する。
    onRequest(cb: (requestId: number) => void): () => void
    done(p: RefreshDonePayload): Promise<void>
  }
  // MCP サーバ（既定 off、トークン未生成）。
  mcp: {
    getConfig(): Promise<McpConfigView>
    setEnabled(on: boolean): Promise<McpStatus>
    setPort(port: number): Promise<McpStatus>
    // 生トークンが renderer に渡る唯一の経路。以後 getConfig() はマスク済みしか返さない。
    generateToken(): Promise<{ config: McpConfigView; token: string }>
    getStatus(): Promise<McpStatus>
    onStatusChanged(cb: (s: McpStatus) => void): () => void
  }
}

declare global {
  interface Window {
    api: Api
  }
}
