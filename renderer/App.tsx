import { useState, useEffect, useCallback } from 'react'
import Settings from './components/Settings'
import FileUpload from './components/FileUpload'
import ProgressLog from './components/ProgressLog'
import BugTable from './components/BugTable'
import type { AnalyzedBug, IPCEvent, LogEvent, ProgressEvent, BugResultEvent, IndexProgressEvent } from '../src/types/index'

type Tab = 'main' | 'settings'
type Phase = 'idle' | 'analyzing' | 'done'

export interface LogLine {
  id: number
  level: 'info' | 'warn' | 'error'
  message: string
  timestamp: string
}

let logCounter = 0

export default function App() {
  const [tab, setTab] = useState<Tab>('main')
  const [phase, setPhase] = useState<Phase>('idle')
  const [excelPath, setExcelPath] = useState<string | null>(null)
  const [results, setResults] = useState<AnalyzedBug[]>([])
  const [logs, setLogs] = useState<LogLine[]>([])
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' })
  const [indexProgress, setIndexProgress] = useState({ filesProcessed: 0, totalFiles: 0, message: '' })
  const [isIndexing, setIsIndexing] = useState(false)
  const [hasIndex, setHasIndex] = useState(false)
  const [showLogs, setShowLogs] = useState(false)

  const addLog = useCallback((level: LogLine['level'], message: string, timestamp?: string) => {
    setLogs((prev) => [
      ...prev.slice(-499), // keep last 500
      { id: logCounter++, level, message, timestamp: timestamp ?? new Date().toISOString() },
    ])
  }, [])

  // Set up IPC listeners
  useEffect(() => {
    const api = window.electronAPI

    const cleanProgress = api.onProgress((ev: IPCEvent) => {
      if (ev.type !== 'progress') return
      const e = ev as ProgressEvent
      setProgress({ current: e.current, total: e.total, message: e.message })
    })

    const cleanLog = api.onLog((ev: IPCEvent) => {
      if (ev.type !== 'log') return
      const e = ev as LogEvent
      addLog(e.level, e.message, e.timestamp)
    })

    const cleanBugResult = api.onBugResult((ev: IPCEvent) => {
      if (ev.type !== 'bug-result') return
      const e = ev as BugResultEvent
      // Append result immediately — table updates in real-time
      setResults((prev) => {
        // Avoid duplicates if complete event also fires
        const exists = prev.some((r) => r.enriched.raw.id === e.result.enriched.raw.id)
        return exists ? prev : [...prev, e.result]
      })
      // Switch to showing results as soon as first one arrives
      setPhase('analyzing')
    })

    const cleanComplete = api.onAnalysisComplete((ev: IPCEvent) => {
      if (ev.type !== 'complete') return
      // Replace with final ordered list
      setResults(ev.results as AnalyzedBug[])
      setPhase('done')
      addLog('info', `✅ Análisis completo: ${(ev.results as AnalyzedBug[]).length} bugs procesados`)
    })

    const cleanIndex = api.onIndexProgress((ev: IPCEvent) => {
      if (ev.type !== 'index-progress') return
      const e = ev as IndexProgressEvent
      setIndexProgress({ filesProcessed: e.filesProcessed, totalFiles: e.totalFiles, message: e.message })
    })

    // Check index on mount
    api.hasIndex().then((r: { hasIndex: boolean }) => setHasIndex(r.hasIndex))

    return () => {
      cleanProgress()
      cleanLog()
      cleanBugResult()
      cleanComplete()
      cleanIndex()
    }
  }, [addLog])

  const handleAnalyze = useCallback(async () => {
    if (!excelPath) return
    setPhase('analyzing')
    setResults([])
    setLogs([])
    setShowLogs(false)
    setProgress({ current: 0, total: 0, message: 'Iniciando...' })
    addLog('info', 'Iniciando análisis...')

    const result = await window.electronAPI.runAnalysis(excelPath)
    if (!result.ok) {
      addLog('error', `Error: ${result.error}`)
      setPhase('idle')
    }
  }, [excelPath, addLog])

  const handleIndexRepos = useCallback(async () => {
    setIsIndexing(true)
    setIndexProgress({ filesProcessed: 0, totalFiles: 0, message: 'Iniciando indexación...' })
    addLog('info', 'Iniciando indexación de repos...')

    const result = await window.electronAPI.indexRepos()
    setIsIndexing(false)

    if (result.ok) {
      setHasIndex(true)
      addLog('info', 'Repos indexados correctamente')
    } else {
      addLog('error', `Error al indexar: ${result.error}`)
    }
  }, [addLog])

  const handleExport = useCallback(async () => {
    if (!excelPath || results.length === 0) return
    const result = await window.electronAPI.exportExcel(excelPath, results)
    if (result.ok) {
      addLog('info', `Excel exportado: ${result.filePath}`)
    } else if (result.error) {
      addLog('error', `Error al exportar: ${result.error}`)
    }
  }, [excelPath, results, addLog])

  const handleReset = useCallback(() => {
    setPhase('idle')
    setExcelPath(null)
    setResults([])
    setLogs([])
    setProgress({ current: 0, total: 0, message: '' })
  }, [])

  return (
    <div className="flex flex-col h-screen bg-gray-950">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-sm font-bold">
            🐛
          </div>
          <span className="font-semibold text-gray-100">Bug Analyzer</span>
          {hasIndex && (
            <span className="text-xs bg-green-900 text-green-300 border border-green-700 px-2 py-0.5 rounded-full">
              Índice activo
            </span>
          )}
        </div>

        <nav className="flex gap-1">
          {(['main', 'settings'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === t
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
            >
              {t === 'main' ? '🏠 Principal' : '⚙️ Configuración'}
            </button>
          ))}
        </nav>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {tab === 'settings' ? (
          <Settings
            onIndexRepos={handleIndexRepos}
            isIndexing={isIndexing}
            indexProgress={indexProgress}
            hasIndex={hasIndex}
            onIndexDeleted={() => setHasIndex(false)}
            addLog={addLog}
          />
        ) : (
          <div className="flex h-full">
            {/* Left panel */}
            <div className="w-80 flex-shrink-0 flex flex-col gap-4 p-4 border-r border-gray-800 overflow-y-auto">
              <FileUpload
                excelPath={excelPath}
                onFileSelected={setExcelPath}
                disabled={phase === 'analyzing'}
              />

              {phase === 'idle' && (
                <button
                  className="btn-primary w-full flex items-center justify-center gap-2"
                  onClick={handleAnalyze}
                  disabled={!excelPath}
                >
                  <span>🔍</span>
                  Analizar bugs
                </button>
              )}

              {phase === 'analyzing' && (
                <div className="card">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
                    <div className="text-xs text-gray-400 flex-1 truncate">{progress.message}</div>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-1.5">
                    <div
                      className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500"
                      style={{
                        width: progress.total > 0
                          ? `${(progress.current / progress.total) * 100}%`
                          : '5%',
                      }}
                    />
                  </div>
                  {progress.total > 0 && (
                    <div className="text-xs text-gray-600 mt-1 text-right">
                      {progress.current} / {progress.total}
                    </div>
                  )}
                  <button
                    onClick={() => setShowLogs((v) => !v)}
                    className="text-xs text-gray-600 hover:text-gray-400 mt-2 w-full text-left"
                  >
                    {showLogs ? '▼ Ocultar logs' : '▶ Ver logs'}
                  </button>
                </div>
              )}

              {phase === 'done' && (
                <div className="flex flex-col gap-2">
                  <button
                    className="btn-primary w-full flex items-center justify-center gap-2"
                    onClick={handleExport}
                  >
                    <span>📥</span>
                    Exportar Excel
                  </button>
                  <button
                    className="btn-secondary w-full"
                    onClick={handleReset}
                  >
                    Nuevo análisis
                  </button>
                </div>
              )}

              {/* Stats */}
              {phase === 'done' && results.length > 0 && (
                <div className="card">
                  <div className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
                    Resumen
                  </div>
                  <StatsGrid results={results} />
                </div>
              )}
            </div>

            {/* Right panel */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {results.length > 0 ? (
                <div className="flex flex-col h-full">
                  {/* Live results table */}
                  <div className={showLogs ? 'flex-1 overflow-hidden' : 'flex-1 overflow-hidden'}>
                    <BugTable results={results} analyzing={phase === 'analyzing'} />
                  </div>
                  {/* Collapsible log strip */}
                  {showLogs && (
                    <div className="h-40 flex-shrink-0 border-t border-gray-800">
                      <ProgressLog logs={logs} />
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 overflow-hidden">
                  <ProgressLog logs={logs} />
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function StatsGrid({ results }: { results: AnalyzedBug[] }) {
  const counts = results.reduce(
    (acc, r) => {
      acc.categories[r.analysis.category] = (acc.categories[r.analysis.category] ?? 0) + 1
      acc.severities[r.analysis.severity] = (acc.severities[r.analysis.severity] ?? 0) + 1
      return acc
    },
    { categories: {} as Record<string, number>, severities: {} as Record<string, number> }
  )

  const severityColors: Record<string, string> = {
    critical: 'text-red-400',
    high: 'text-orange-400',
    medium: 'text-amber-400',
    low: 'text-green-400',
  }

  return (
    <div className="space-y-2 text-xs">
      {Object.entries(counts.severities).map(([s, n]) => (
        <div key={s} className="flex justify-between">
          <span className={severityColors[s] ?? 'text-gray-400'}>{s}</span>
          <span className="text-gray-300 font-mono">{n}</span>
        </div>
      ))}
      <div className="border-t border-gray-800 pt-2 mt-2">
        {Object.entries(counts.categories).map(([c, n]) => (
          <div key={c} className="flex justify-between">
            <span className="text-indigo-400">{c}</span>
            <span className="text-gray-300 font-mono">{n}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
