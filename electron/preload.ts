import { contextBridge, ipcRenderer } from 'electron'
import type { AnalyzedBug, IPCEvent } from '../src/types/index.js'

// Expose a typed API to the renderer via window.electronAPI
contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Record<string, string>) => ipcRenderer.invoke('settings:save', settings),
  pickDirectory: () => ipcRenderer.invoke('settings:pick-directory'),

  // Google Auth (OAuth)
  getAuthStatus: () => ipcRenderer.invoke('google:auth-status'),
  startAuth: () => ipcRenderer.invoke('google:start-auth'),
  revokeAuth: () => ipcRenderer.invoke('google:revoke'),

  // Google Auth (Browser session — no OAuth needed)
  getBrowserAuthStatus: () => ipcRenderer.invoke('browser-auth:status'),
  startBrowserLogin: () => ipcRenderer.invoke('browser-auth:start-login'),
  revokeBrowserAuth: () => ipcRenderer.invoke('browser-auth:revoke'),

  // Repo
  indexRepos: () => ipcRenderer.invoke('repo:index'),
  hasIndex: () => ipcRenderer.invoke('repo:has-index'),
  deleteIndex: () => ipcRenderer.invoke('repo:delete-index'),

  // Analysis
  runAnalysis: (excelPath: string) => ipcRenderer.invoke('analyze:run', excelPath),
  exportExcel: (originalPath: string, results: AnalyzedBug[]) =>
    ipcRenderer.invoke('export:excel', { originalPath, results }),

  // Dialogs
  openExcelDialog: () => ipcRenderer.invoke('dialog:open-excel'),

  // LLM
  checkOllama: () => ipcRenderer.invoke('llm:check-ollama'),
  startOllama: () => ipcRenderer.invoke('llm:start-ollama'),

  // Event listeners
  onProgress: (cb: (event: IPCEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: IPCEvent) => cb(data)
    ipcRenderer.on('progress', handler)
    return () => ipcRenderer.removeListener('progress', handler)
  },
  onLog: (cb: (event: IPCEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: IPCEvent) => cb(data)
    ipcRenderer.on('log', handler)
    return () => ipcRenderer.removeListener('log', handler)
  },
  onAnalysisComplete: (cb: (event: IPCEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: IPCEvent) => cb(data)
    ipcRenderer.on('analysis-complete', handler)
    return () => ipcRenderer.removeListener('analysis-complete', handler)
  },
  onBugResult: (cb: (event: IPCEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: IPCEvent) => cb(data)
    ipcRenderer.on('bug-result', handler)
    return () => ipcRenderer.removeListener('bug-result', handler)
  },
  onIndexProgress: (cb: (event: IPCEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: IPCEvent) => cb(data)
    ipcRenderer.on('index-progress', handler)
    return () => ipcRenderer.removeListener('index-progress', handler)
  },
})
