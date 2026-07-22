import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { configureProxy } from './net/httpClient'
import { CH } from '@shared/ipc'
import { buildCompanyHash } from '@shared/companyWindow'

// One company-info window per symbol (spec: side-by-side compare). Reopening a live symbol focuses
// its window; a new symbol spawns another. Cleared on 'closed'.
const companyWindows = new Map<string, BrowserWindow>()

// Load the shared renderer bundle, optionally with a hash (e.g. company=AAPL) that main.tsx reads
// to mount CompanyWindow instead of App. Dev serves from ELECTRON_RENDERER_URL; prod loads the file.
function loadRenderer(win: BrowserWindow, hash?: string): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + (hash ? '#' + hash : ''))
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0B0E11',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('ready-to-show', () => win.show())
  // Closing the main window tears down company windows so window-all-closed fires → app quits.
  win.on('closed', () => {
    for (const w of companyWindows.values()) w.close()
  })
  loadRenderer(win)
}

function openCompanyWindow(symbol: string): void {
  const existing = companyWindows.get(symbol)
  if (existing) {
    existing.focus()
    return
  }
  const win = new BrowserWindow({
    width: 480,
    height: 680,
    backgroundColor: '#0B0E11',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  companyWindows.set(symbol, win)
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => companyWindows.delete(symbol))
  loadRenderer(win, buildCompanyHash(symbol))
}

app.whenReady().then(async () => {
  // Route provider HTTP through the OS/system proxy (or HTTP(S)_PROXY) before any fetch runs —
  // corporate networks block direct egress, so an unconfigured client times out (see net/httpClient).
  await configureProxy()
  registerIpc()
  ipcMain.handle(CH.companyOpenWindow, (_e, symbol: string) => openCompanyWindow(symbol))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
