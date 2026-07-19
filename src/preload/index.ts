import { contextBridge, ipcRenderer } from 'electron'
import type { Timeframe, DateRange } from '@shared/types'
import { CH, type Api } from '@shared/ipc'

const api: Api = {
  symbols: { search: (query) => ipcRenderer.invoke(CH.symbolsSearch, query) },
  ohlcv: {
    get: (symbol, timeframe: Timeframe, range: DateRange) =>
      ipcRenderer.invoke(CH.ohlcvGet, symbol, timeframe, range)
  },
  apikey: {
    set: (key) => ipcRenderer.invoke(CH.apikeySet, key),
    status: () => ipcRenderer.invoke(CH.apikeyStatus),
    clear: () => ipcRenderer.invoke(CH.apikeyClear)
  },
  settings: {
    getLastSymbol: () => ipcRenderer.invoke(CH.settingsGetLastSymbol),
    setLastSymbol: (symbol) => ipcRenderer.invoke(CH.settingsSetLastSymbol, symbol)
  },
  capabilities: { get: () => ipcRenderer.invoke(CH.capabilitiesGet) }
}

contextBridge.exposeInMainWorld('api', api)
