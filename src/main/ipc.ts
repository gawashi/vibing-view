import { ipcMain, BrowserWindow } from 'electron'
import type { Timeframe, DateRange, WorkspaceCollection, ClipboardCell, EconomicFilterPref } from '@shared/types'
import { CH, type RefreshAppliedPayload, type RefreshDonePayload } from '@shared/ipc'
import { toBars, type Core } from './core'
import {
  getLastSymbol, setLastSymbol, getSidebarOpen, setSidebarOpen, getSidebarWidth, setSidebarWidth,
  getTheme, setTheme, getAutoRefresh, setAutoRefresh, type Theme,
  getMcpConfigView, setMcpConfig, generateMcpToken,
  getEconomicFilter, setEconomicFilter
} from './settings'
import * as mcp from './mcp'

// Thin transport layer: channel name → core method. Every behaviour (capability tracking, cache
// decisions, rev bookkeeping) lives in core.ts so MCP gets the identical semantics.
export function registerIpc(core: Core): void {
  ipcMain.handle(CH.symbolsSearch, (_e, query: string) => core.symbols.search(query))
  ipcMain.handle(CH.symbolsProfile, (_e, symbol: string) => core.symbols.profile(symbol))
  ipcMain.handle(CH.companyInfo, (_e, symbol: string, opts?: { force?: boolean }) => core.company.info(symbol, opts))
  ipcMain.handle(CH.economicCalendar, (_e, from: string, to: string, opts?: { force?: boolean }) =>
    core.economicCalendar.getRange(from, to, opts)
  )

  ipcMain.handle(CH.ohlcvGet, async (_e, symbol: string, timeframe: Timeframe, range: DateRange) =>
    toBars(await core.ohlcv.get(symbol, timeframe, range))
  )
  ipcMain.handle(CH.ohlcvRefresh, async (_e, symbol: string, timeframe: Timeframe) =>
    toBars(await core.ohlcv.refresh(symbol, timeframe))
  )

  ipcMain.handle(CH.quoteGet, (_e, symbol: string) => core.quote.get(symbol))
  ipcMain.handle(CH.marketStatus, () => core.market.status())

  ipcMain.handle(CH.apikeySet, (_e, key: string) => core.apikey.set(key))
  ipcMain.handle(CH.apikeyStatus, () => core.apikey.status())
  ipcMain.handle(CH.apikeyClear, () => core.apikey.clear())

  ipcMain.handle(CH.settingsGetLastSymbol, () => getLastSymbol())
  ipcMain.handle(CH.settingsSetLastSymbol, (_e, symbol: string) => setLastSymbol(symbol))
  ipcMain.handle(CH.settingsGetSidebarOpen, () => getSidebarOpen())
  ipcMain.handle(CH.settingsSetSidebarOpen, (_e, open: boolean) => setSidebarOpen(open))
  ipcMain.handle(CH.settingsGetSidebarWidth, () => getSidebarWidth())
  ipcMain.handle(CH.settingsSetSidebarWidth, (_e, width: number) => setSidebarWidth(width))
  ipcMain.handle(CH.settingsGetTheme, () => getTheme())
  ipcMain.handle(CH.settingsSetTheme, (_e, theme: Theme) => setTheme(theme))
  ipcMain.handle(CH.settingsGetAutoRefresh, () => getAutoRefresh())
  ipcMain.handle(CH.settingsSetAutoRefresh, (_e, on: boolean) => setAutoRefresh(on))
  ipcMain.handle(CH.settingsGetEconomicFilter, () => getEconomicFilter())
  ipcMain.handle(CH.settingsSetEconomicFilter, (_e, filter: EconomicFilterPref) => setEconomicFilter(filter))

  ipcMain.handle(CH.workspacesGet, () => core.workspaces.get())
  ipcMain.handle(CH.workspacesSet, (e, c: WorkspaceCollection) => core.workspaces.set(c, e.sender.id))

  ipcMain.handle(CH.clipboardGet, () => core.clipboard.get())
  ipcMain.handle(CH.clipboardSet, (e, c: ClipboardCell | null) => core.clipboard.set(c, e.sender.id))

  // refresh 配信: 送信元(メインウィンドウ)以外の全ウィンドウへ転送。純粋な転送で状態を持たないので
  // core には置かない。
  ipcMain.handle(CH.refreshBroadcast, (e, p: RefreshAppliedPayload) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.webContents.id !== e.sender.id) w.webContents.send(CH.refreshApplied, p)
    }
  })

  // メインウィンドウからの完了通知を core の待ち receiver へ渡す（force_reload、MW-14）。
  ipcMain.handle(CH.refreshDone, (_e, p: RefreshDonePayload) => core.uiRefresh.settle(p))

  ipcMain.handle(CH.capabilitiesGet, () => core.capabilities.get())

  ipcMain.handle(CH.mcpGetConfig, () => getMcpConfigView())
  ipcMain.handle(CH.mcpGetStatus, () => mcp.getStatus())
  ipcMain.handle(CH.mcpSetEnabled, (_e, on: boolean) => mcp.applyConfig(core, setMcpConfig({ enabled: on })))
  ipcMain.handle(CH.mcpSetPort, (_e, port: number) => mcp.applyConfig(core, setMcpConfig({ port })))
  ipcMain.handle(CH.mcpGenerateToken, async () => {
    const config = generateMcpToken()
    await mcp.applyConfig(core, config) // a live server must stop honouring the old token
    // 生トークンを renderer に渡すのはこの戻り値だけ。以後は getConfig() のマスク済みのみ。
    return { config: getMcpConfigView(), token: config.token }
  })
}
