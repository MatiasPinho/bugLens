import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as cp from 'child_process'
import * as dotenv from 'dotenv'

// Load .env from project root (dev) or app resources (prod)
const envPath = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '..', '.env')
dotenv.config({ path: envPath })

import { readExcel, writeEnrichedExcel } from '../src/pipeline/excelReader.js'
import { GoogleDocsReader } from '../src/pipeline/googleDocsReader.js'
import { BrowserDocsReader } from '../src/pipeline/browserDocsReader.js'
import { RepoIndexer } from '../src/pipeline/repoIndexer.js'
import { BugEnricher } from '../src/pipeline/bugEnricher.js'
import { analyzeBug, getLLMConfig } from '../src/llm/client.js'
import type { AnalyzedBug, LLMConfig } from '../src/types/index.js'

// ─── Simple JSON config store ─────────────────────────────────────────────────
// Replaces electron-store to avoid ESM/CJS conflicts.

interface AppSettings {
  frontendRepoPath: string
  backendRepoPath: string
  googleClientId: string
  googleClientSecret: string
  llmProvider: string
  llmModel: string
  ollamaBaseUrl: string
  indexPath: string
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadSettings(): AppSettings {
  const defaults: AppSettings = {
    frontendRepoPath: '',
    backendRepoPath: '',
    googleClientId: process.env['GOOGLE_CLIENT_ID'] ?? '',
    googleClientSecret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
    llmProvider: process.env['LLM_PROVIDER'] ?? 'ollama',
    llmModel: process.env['LLM_MODEL'] ?? process.env['OLLAMA_MODEL'] ?? 'mistral',
    ollamaBaseUrl: process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434',
    indexPath: path.join(app.getPath('userData'), 'repo-index'),
  }

  const configPath = getConfigPath()
  if (!fs.existsSync(configPath)) return defaults

  try {
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<AppSettings>
    return { ...defaults, ...saved }
  } catch {
    return defaults
  }
}

function saveSettings(patch: Partial<AppSettings>): void {
  const current = loadSettings()
  const updated = { ...current, ...patch }
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true })
  fs.writeFileSync(getConfigPath(), JSON.stringify(updated, null, 2))
}

// ─── Window ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Bug Analyzer',
  })

  // app.isPackaged === false during dev (electron .), true in packaged builds
  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendToRenderer(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

function log(level: 'info' | 'warn' | 'error', message: string): void {
  console.log(`[${level.toUpperCase()}] ${message}`)
  sendToRenderer('log', {
    type: 'log',
    level,
    message,
    timestamp: new Date().toISOString(),
  })
}

// ─── Lazy singleton factories ─────────────────────────────────────────────────

function makeGoogleReader(): GoogleDocsReader {
  const s = loadSettings()
  const tokenPath = path.join(app.getPath('userData'), 'google-token.json')
  return new GoogleDocsReader(s.googleClientId, s.googleClientSecret, tokenPath)
}

function makeBrowserReader(): BrowserDocsReader {
  return new BrowserDocsReader(app.getPath('userData'))
}

function makeRepoIndexer(): RepoIndexer {
  const s = loadSettings()
  return new RepoIndexer(s.indexPath)
}

// ─── IPC: Settings ────────────────────────────────────────────────────────────

ipcMain.handle('settings:get', () => loadSettings())

ipcMain.handle('settings:save', (_e, patch: Partial<AppSettings>) => {
  saveSettings(patch)
  return { ok: true }
})

ipcMain.handle('settings:pick-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

// ─── IPC: Google Auth ─────────────────────────────────────────────────────────

ipcMain.handle('google:auth-status', () => {
  return { authenticated: makeGoogleReader().isAuthenticated() }
})

ipcMain.handle('google:start-auth', async () => {
  const reader = makeGoogleReader()
  const authUrl = reader.getAuthUrl()
  await shell.openExternal(authUrl)
  try {
    await reader.waitForCallback()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('google:revoke', async () => {
  await makeGoogleReader().revokeAuth()
  return { ok: true }
})

// ─── IPC: Browser-based Google Auth (cookie session, no OAuth) ───────────────

ipcMain.handle('browser-auth:status', () => {
  return { authenticated: makeBrowserReader().isAuthenticated() }
})

ipcMain.handle('browser-auth:start-login', async () => {
  const reader = makeBrowserReader()
  try {
    await reader.startLoginFlow()
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('error', `Error en login del navegador: ${message}`)
    return { ok: false, error: message }
  }
})

ipcMain.handle('browser-auth:revoke', () => {
  makeBrowserReader().revokeSession()
  return { ok: true }
})

// ─── IPC: Repo indexing ───────────────────────────────────────────────────────

ipcMain.handle('repo:index', async () => {
  const s = loadSettings()
  const paths = [s.frontendRepoPath, s.backendRepoPath].filter(Boolean)
  if (paths.length === 0) return { ok: false, error: 'No hay paths de repos configurados.' }

  const indexer = makeRepoIndexer()
  try {
    await indexer.indexRepos(paths, (msg, processed, total) => {
      sendToRenderer('index-progress', { type: 'index-progress', message: msg, filesProcessed: processed, totalFiles: total })
    })
    log('info', 'Índice del repo completado')
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('error', `Error indexando repos: ${message}`)
    return { ok: false, error: message }
  }
})

ipcMain.handle('repo:has-index', async () => {
  return { hasIndex: await makeRepoIndexer().hasIndex() }
})

ipcMain.handle('repo:delete-index', async () => {
  await makeRepoIndexer().deleteIndex()
  return { ok: true }
})

// ─── IPC: Main analysis pipeline ─────────────────────────────────────────────

ipcMain.handle('analyze:run', async (_e, excelPath: string) => {
  const start = Date.now()

  try {
    log('info', `Leyendo Excel: ${excelPath}`)
    const bugs = readExcel(excelPath)
    log('info', `Encontrados ${bugs.length} bugs`)

    const s = loadSettings()
    const llmConfig: LLMConfig = getLLMConfig({
      provider: s.llmProvider as LLMConfig['provider'],
      model: s.llmModel,
      baseUrl: s.ollamaBaseUrl,
    })

    // Auto-levantar Ollama si es el provider elegido y no está corriendo
    if (s.llmProvider === 'ollama') {
      const baseUrl = s.ollamaBaseUrl || 'http://localhost:11434'
      const { started, alreadyRunning } = await ensureOllamaRunning(baseUrl)
      if (started)        log('info', 'Ollama iniciado automáticamente')
      else if (alreadyRunning) log('info', 'Ollama ya estaba corriendo')
      else                log('warn', 'No se pudo levantar Ollama — el análisis puede fallar')
    }

    const repoIndexer = makeRepoIndexer()

    // Prefer browser-session reader (no OAuth, company can't see it in Cloud Console)
    // Fall back to OAuth reader if browser session is not set up
    const browserReader = makeBrowserReader()
    const oauthReader = makeGoogleReader()

    let docsReader: { readDocuments(urls: string[]): Promise<import('../src/types/index.js').GoogleDocContent[]> } | null = null
    if (browserReader.isAuthenticated()) {
      docsReader = browserReader
      log('info', 'Acceso a Google Docs via sesión del navegador')
    } else if (oauthReader.isAuthenticated()) {
      docsReader = oauthReader
      log('info', 'Acceso a Google Docs via OAuth')
    } else {
      log('warn', 'Google no autenticado — bugs sin documentos de evidencia')
    }

    const enricher = new BugEnricher(docsReader, repoIndexer)

    // Concurrency per provider:
    // - Cloud APIs: run 5 bugs in parallel (rate limits allow it, huge speedup)
    // - Ollama: 2 concurrent (queues internally anyway, but avoids head-of-line blocking)
    const CONCURRENCY: Record<string, number> = {
      anthropic: 5,
      openai:    5,
      gemini:    5,
      ollama:    2,
    }
    const concurrency = CONCURRENCY[llmConfig.provider] ?? 2

    log('info', `Paralelismo: ${concurrency} bugs simultáneos (${llmConfig.provider})`)

    // Warm up the repo index into memory (one disk read for all bugs)
    await repoIndexer.warmUp()

    // Results array preserves original order
    const results: AnalyzedBug[] = new Array(bugs.length)
    let completed = 0

    // Worker-pool pattern: N workers consume from shared queue
    async function processBug(i: number): Promise<void> {
      const bug = bugs[i]
      const bugStart = Date.now()

      log('info', `[${i + 1}/${bugs.length}] ${bug.title}`)

      try {
        const enriched = await enricher.enrich(bug)

        for (const doc of enriched.googleDocs) {
          if (!doc.accessible) log('warn', `  Doc no accesible: ${doc.url}`)
          else                  log('info',  `  Doc leído: ${doc.title}`)
        }
        if (enriched.codeFragments.length > 0) {
          const files = enriched.codeFragments.slice(0, 3).map((f) => path.basename(f.filePath)).join(', ')
          log('info', `  Código: ${files}`)
        }

        const repoPaths = [s.frontendRepoPath, s.backendRepoPath].filter(Boolean)
        const analysis = await analyzeBug(enriched, llmConfig, repoPaths, (msg) => log('info', msg))
        const result: AnalyzedBug = { enriched, analysis, processingMs: Date.now() - bugStart }

        results[i] = result
        completed++

        log('info', `✓ [${completed}/${bugs.length}] ${analysis.severity} ${analysis.category} — ${bug.title}`)

        // Stream result to renderer immediately — don't wait for all bugs
        sendToRenderer('bug-result', {
          type: 'bug-result',
          result,
          current: completed,
          total: bugs.length,
        })
        sendToRenderer('progress', {
          type: 'progress',
          message: `${completed}/${bugs.length} analizados — ${bug.title}`,
          current: completed,
          total: bugs.length,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log('error', `✗ Bug ${i + 1} falló: ${message}`)
        const result: AnalyzedBug = {
          enriched: { raw: bug, googleDocs: [], codeFragments: [] },
          analysis: {
            category: 'insufficient_info',
            severity: 'low',
            difficulty: 'low',
            confidence: 0,
            summary: 'Error durante el análisis',
            affectedArea: '',
            classificationReason: '',
            confidenceReason: '',
            probableCause: `Error: ${message}`,
            suggestedFixSteps: [],
            investigationSteps: [],
            evidenceUsed: [],
            cannotConclude: [],
            relatedFilesWithReasons: [],
            relatedFiles: [],
            needsMoreInfo: true,
            rawResponse: message,
          },
          error: message,
          processingMs: Date.now() - bugStart,
        }
        results[i] = result
        completed++

        sendToRenderer('bug-result', { type: 'bug-result', result, current: completed, total: bugs.length })
        sendToRenderer('progress', { type: 'progress', message: `${completed}/${bugs.length} analizados`, current: completed, total: bugs.length })
      }
    }

    // Run workers: each picks the next unstarted bug until all are done
    let nextIdx = 0
    async function worker() {
      while (nextIdx < bugs.length) {
        const i = nextIdx++
        await processBug(i)
      }
    }

    sendToRenderer('progress', { type: 'progress', message: `Iniciando análisis de ${bugs.length} bugs...`, current: 0, total: bugs.length })
    await Promise.all(Array.from({ length: Math.min(concurrency, bugs.length) }, worker))

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    log('info', `Análisis completado en ${elapsed}s (${(bugs.length / parseFloat(elapsed)).toFixed(1)} bugs/s)`)
    sendToRenderer('analysis-complete', { type: 'complete', results: results.filter(Boolean) })

    // Cerrar el contexto headless del browser reader para liberar recursos
    if (browserReader instanceof BrowserDocsReader) {
      await browserReader.closeContext().catch(() => {})
    }

    return { ok: true, count: results.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('error', `Error general: ${message}`)
    return { ok: false, error: message }
  }
})

// ─── IPC: Export ─────────────────────────────────────────────────────────────

ipcMain.handle('export:excel', async (_e, { originalPath, results }: { originalPath: string; results: AnalyzedBug[] }) => {
  const defaultName = path.basename(originalPath, path.extname(originalPath)) + '_analizado.xlsx'
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: defaultName,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  })

  if (canceled || !filePath) return { ok: false }

  try {
    writeEnrichedExcel(filePath, originalPath, results.map((r) => ({
      rowIndex: r.enriched.raw.rowIndex,
      category: r.analysis.category,
      severity: r.analysis.severity,
      difficulty: r.analysis.difficulty,
      confidence: r.analysis.confidence,
      probableCause: r.analysis.probableCause,
      relatedFiles: r.analysis.relatedFiles,
      needsMoreInfo: r.analysis.needsMoreInfo,
      summary: r.analysis.summary,
      error: r.error,
    })))
    log('info', `Excel exportado: ${filePath}`)
    return { ok: true, filePath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log('error', `Error exportando: ${message}`)
    return { ok: false, error: message }
  }
})

// ─── IPC: Dialogs & misc ─────────────────────────────────────────────────────

ipcMain.handle('dialog:open-excel', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'csv'] }],
  })
  return result.canceled ? null : result.filePaths[0]
})

// ─── Ollama helpers ───────────────────────────────────────────────────────────

let ollamaProcess: cp.ChildProcess | null = null

/** Busca el binario de ollama en rutas comunes. */
function findOllamaBin(): string | null {
  const candidates = [
    process.env['HOME'] ? path.join(process.env['HOME'], '.local', 'bin', 'ollama') : null,
    '/usr/local/bin/ollama',
    '/usr/bin/ollama',
    '/opt/homebrew/bin/ollama',
    process.env['OLLAMA_BIN'],
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

/** Pinga Ollama. Devuelve true si responde. */
async function pingOllama(baseUrl: string): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
    return r.ok
  } catch {
    return false
  }
}

/** Intenta levantar `ollama serve` si no está corriendo. */
async function ensureOllamaRunning(baseUrl: string): Promise<{ started: boolean; alreadyRunning: boolean }> {
  if (await pingOllama(baseUrl)) return { started: false, alreadyRunning: true }

  const bin = findOllamaBin()
  if (!bin) return { started: false, alreadyRunning: false }

  log('info', `Levantando Ollama: ${bin}`)
  // HSA_OVERRIDE_GFX_VERSION=10.3.0 is required for AMD RDNA2 GPUs (RX 6xxx series, gfx1030/1031/1032)
  // that are not in Ollama's bundled ROCm TensileLibrary. Maps gfx1032 → gfx1030 codepath.
  ollamaProcess = cp.spawn(bin, ['serve'], {
    detached: false,
    stdio: 'ignore',
    env: { ...process.env, HSA_OVERRIDE_GFX_VERSION: '10.3.0' },
  })
  ollamaProcess.unref()

  // Esperar hasta 15 s a que responda
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 800))
    if (await pingOllama(baseUrl)) {
      log('info', 'Ollama levantado correctamente')
      return { started: true, alreadyRunning: false }
    }
  }

  return { started: false, alreadyRunning: false }
}

// Cerrar ollama al salir de la app (solo si lo levantamos nosotros)
app.on('before-quit', () => {
  if (ollamaProcess) {
    ollamaProcess.kill()
    ollamaProcess = null
  }
})

ipcMain.handle('llm:check-ollama', async () => {
  const s = loadSettings()
  const baseUrl = s.ollamaBaseUrl || 'http://localhost:11434'
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) return { available: false }
    const data = (await response.json()) as { models?: Array<{ name: string }> }
    return { available: true, models: data.models?.map((m) => m.name) ?? [] }
  } catch {
    return { available: false, models: [] }
  }
})

ipcMain.handle('llm:start-ollama', async () => {
  const s = loadSettings()
  const baseUrl = s.ollamaBaseUrl || 'http://localhost:11434'
  const result = await ensureOllamaRunning(baseUrl)
  if (result.alreadyRunning) return { ok: true, message: 'Ollama ya estaba corriendo' }
  if (result.started)        return { ok: true, message: 'Ollama iniciado correctamente' }
  return { ok: false, message: 'No se encontró el binario de Ollama — instalalo primero' }
})
