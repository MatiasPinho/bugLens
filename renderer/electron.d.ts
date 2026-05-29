import type { AnalyzedBug, IPCEvent } from '../src/types/index'

interface ElectronAPI {
  // Settings
  getSettings(): Promise<{
    frontendRepoPath: string
    backendRepoPath: string
    googleClientId: string
    googleClientSecret: string
    llmProvider: string
    llmModel: string
    ollamaBaseUrl: string
    indexPath: string
  }>
  saveSettings(settings: Record<string, string>): Promise<{ ok: boolean }>
  pickDirectory(): Promise<string | null>

  // Google Auth (OAuth)
  getAuthStatus(): Promise<{ authenticated: boolean }>
  startAuth(): Promise<{ ok: boolean; error?: string }>
  revokeAuth(): Promise<{ ok: boolean }>

  // Google Auth (Browser session — no OAuth)
  getBrowserAuthStatus(): Promise<{ authenticated: boolean }>
  startBrowserLogin(): Promise<{ ok: boolean; error?: string }>
  revokeBrowserAuth(): Promise<{ ok: boolean }>

  // Repo
  indexRepos(): Promise<{ ok: boolean; error?: string }>
  hasIndex(): Promise<{ hasIndex: boolean }>
  deleteIndex(): Promise<{ ok: boolean }>

  // Analysis
  runAnalysis(excelPath: string): Promise<{ ok: boolean; count?: number; error?: string }>
  deepAnalysis(bug: AnalyzedBug): Promise<{ ok: boolean; result?: AnalyzedBug; error?: string }>

  // Cache
  cacheStats(): Promise<{ fast: number; deep: number; sizeKB: number }>
  clearCache(): Promise<{ ok: boolean }>
  exportExcel(
    originalPath: string,
    results: AnalyzedBug[]
  ): Promise<{ ok: boolean; filePath?: string; error?: string }>

  // Dialogs
  openExcelDialog(): Promise<string | null>

  // LLM
  checkOllama(): Promise<{ available: boolean; models?: string[] }>
  startOllama(): Promise<{ ok: boolean; message: string }>

  // Events — return cleanup function
  onProgress(cb: (event: IPCEvent) => void): () => void
  onLog(cb: (event: IPCEvent) => void): () => void
  onAnalysisComplete(cb: (event: IPCEvent) => void): () => void
  onBugResult(cb: (event: IPCEvent) => void): () => void
  onIndexProgress(cb: (event: IPCEvent) => void): () => void
  onDeepProgress(cb: (event: { type: 'deep-progress'; bugId: string; message: string }) => void): () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
