import { contextBridge, ipcRenderer } from 'electron'
import type { Timeframe, DateRange, Workspace, WatchlistCollection } from '@shared/types'
import { CH, type Api } from '@shared/ipc'

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
    setTheme: (theme) => ipcRenderer.invoke(CH.settingsSetTheme, theme)
  },
  capabilities: { get: () => ipcRenderer.invoke(CH.capabilitiesGet) },
  layout: {
    getCurrent: () => ipcRenderer.invoke(CH.layoutGetCurrent),
    setCurrent: (ws: Workspace) => ipcRenderer.invoke(CH.layoutSetCurrent, ws),
    list: () => ipcRenderer.invoke(CH.layoutList),
    get: (name: string) => ipcRenderer.invoke(CH.layoutGet, name),
    save: (name: string, ws: Workspace) => ipcRenderer.invoke(CH.layoutSave, name, ws),
    delete: (name: string) => ipcRenderer.invoke(CH.layoutDelete, name),
    rename: (from: string, to: string) => ipcRenderer.invoke(CH.layoutRename, from, to)
  },
  watchlist: {
    get: () => ipcRenderer.invoke(CH.watchlistGet),
    set: (c: WatchlistCollection) => ipcRenderer.invoke(CH.watchlistSet, c)
  }
}

contextBridge.exposeInMainWorld('api', api)
