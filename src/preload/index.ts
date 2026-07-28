import { contextBridge, ipcRenderer } from 'electron'
import type { Timeframe, DateRange, WorkspaceCollection, ClipboardCell } from '@shared/types'
import { CH, type Api, type WorkspacesPayload, type ClipboardPayload, type RefreshAppliedPayload, type RefreshDonePayload, type McpStatus } from '@shared/ipc'

const api: Api = {
  symbols: {
    search: (query) => ipcRenderer.invoke(CH.symbolsSearch, query),
    profile: (symbol) => ipcRenderer.invoke(CH.symbolsProfile, symbol)
  },
  ohlcv: {
    get: (symbol, timeframe: Timeframe, range: DateRange) =>
      ipcRenderer.invoke(CH.ohlcvGet, symbol, timeframe, range),
    refresh: (symbol, timeframe: Timeframe) =>
      ipcRenderer.invoke(CH.ohlcvRefresh, symbol, timeframe)
  },
  quote: { get: (symbol) => ipcRenderer.invoke(CH.quoteGet, symbol) },
  market: { status: () => ipcRenderer.invoke(CH.marketStatus) },
  apikey: {
    set: (key) => ipcRenderer.invoke(CH.apikeySet, key),
    status: () => ipcRenderer.invoke(CH.apikeyStatus),
    clear: () => ipcRenderer.invoke(CH.apikeyClear)
  },
  settings: {
    getLastSymbol: () => ipcRenderer.invoke(CH.settingsGetLastSymbol),
    setLastSymbol: (symbol) => ipcRenderer.invoke(CH.settingsSetLastSymbol, symbol),
    getSidebarOpen: () => ipcRenderer.invoke(CH.settingsGetSidebarOpen),
    setSidebarOpen: (open) => ipcRenderer.invoke(CH.settingsSetSidebarOpen, open),
    getSidebarWidth: () => ipcRenderer.invoke(CH.settingsGetSidebarWidth),
    setSidebarWidth: (width) => ipcRenderer.invoke(CH.settingsSetSidebarWidth, width),
    getTheme: () => ipcRenderer.invoke(CH.settingsGetTheme),
    setTheme: (theme) => ipcRenderer.invoke(CH.settingsSetTheme, theme),
    getAutoRefresh: () => ipcRenderer.invoke(CH.settingsGetAutoRefresh),
    setAutoRefresh: (on) => ipcRenderer.invoke(CH.settingsSetAutoRefresh, on),
    getEconomicFilter: () => ipcRenderer.invoke(CH.settingsGetEconomicFilter),
    setEconomicFilter: (filter) => ipcRenderer.invoke(CH.settingsSetEconomicFilter, filter)
  },
  capabilities: { get: () => ipcRenderer.invoke(CH.capabilitiesGet) },
  workspaces: {
    get: () => ipcRenderer.invoke(CH.workspacesGet),
    set: (c: WorkspaceCollection) => ipcRenderer.invoke(CH.workspacesSet, c),
    onChanged: (cb) => {
      const listener = (_e: unknown, payload: WorkspacesPayload): void => cb(payload)
      ipcRenderer.on(CH.workspacesChanged, listener)
      return () => ipcRenderer.removeListener(CH.workspacesChanged, listener)
    }
  },
  clipboard: {
    get: () => ipcRenderer.invoke(CH.clipboardGet),
    set: (c: ClipboardCell | null) => ipcRenderer.invoke(CH.clipboardSet, c),
    onChanged: (cb) => {
      const listener = (_e: unknown, payload: ClipboardPayload): void => cb(payload)
      ipcRenderer.on(CH.clipboardChanged, listener)
      return () => ipcRenderer.removeListener(CH.clipboardChanged, listener)
    }
  },
  company: {
    info: (symbol, opts) => ipcRenderer.invoke(CH.companyInfo, symbol, opts),
    openWindow: (symbol) => ipcRenderer.invoke(CH.companyOpenWindow, symbol)
  },
  economic: {
    getRange: (from, to, opts) => ipcRenderer.invoke(CH.economicCalendar, from, to, opts),
    openWindow: () => ipcRenderer.invoke(CH.economicOpenWindow)
  },
  economicIndicator: {
    getSeries: (name, opts) => ipcRenderer.invoke(CH.economicIndicator, name, opts),
    openWindow: (name) => ipcRenderer.invoke(CH.economicIndicatorOpenWindow, name),
    getSelected: () => ipcRenderer.invoke(CH.economicIndicatorSelected),
    onSelect: (cb) => {
      const listener = (_e: unknown, name: string): void => cb(name)
      ipcRenderer.on(CH.economicIndicatorSelect, listener)
      return () => ipcRenderer.removeListener(CH.economicIndicatorSelect, listener)
    }
  },
  chart: {
    openWindow: (cellId) => ipcRenderer.invoke(CH.chartOpenWindow, cellId)
  },
  symbolChart: {
    openWindow: (symbol) => ipcRenderer.invoke(CH.symbolChartOpenWindow, symbol)
  },
  refresh: {
    broadcast: (p: RefreshAppliedPayload) => ipcRenderer.invoke(CH.refreshBroadcast, p),
    onApplied: (cb) => {
      const listener = (_e: unknown, p: RefreshAppliedPayload): void => cb(p)
      ipcRenderer.on(CH.refreshApplied, listener)
      return () => ipcRenderer.removeListener(CH.refreshApplied, listener)
    },
    onRequest: (cb) => {
      const listener = (_e: unknown, requestId: number): void => cb(requestId)
      ipcRenderer.on(CH.refreshRequest, listener)
      return () => ipcRenderer.removeListener(CH.refreshRequest, listener)
    },
    done: (p: RefreshDonePayload) => ipcRenderer.invoke(CH.refreshDone, p)
  },
  mcp: {
    getConfig: () => ipcRenderer.invoke(CH.mcpGetConfig),
    setEnabled: (on) => ipcRenderer.invoke(CH.mcpSetEnabled, on),
    setPort: (port) => ipcRenderer.invoke(CH.mcpSetPort, port),
    generateToken: () => ipcRenderer.invoke(CH.mcpGenerateToken),
    getStatus: () => ipcRenderer.invoke(CH.mcpGetStatus),
    onStatusChanged: (cb) => {
      const listener = (_e: unknown, s: McpStatus): void => cb(s)
      ipcRenderer.on(CH.mcpStatusChanged, listener)
      return () => ipcRenderer.removeListener(CH.mcpStatusChanged, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
