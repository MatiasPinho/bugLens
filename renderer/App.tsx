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
      ...prev.slice(-499),
      { id: logCounter++, level, message, timestamp: timestamp ?? new Date().toISOString() },
    ])
  }, [])

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
      setResults((prev) => {
        const exists = prev.some((r) => r.enriched.raw.id === e.result.enriched.raw.id)
        return exists ? prev : [...prev, e.result]
      })
      setPhase('analyzing')
    })

    const cleanComplete = api.onAnalysisComplete((ev: IPCEvent) => {
      if (ev.type !== 'complete') return
      setResults(ev.results as AnalyzedBug[])
      setPhase('done')
      addLog('info', `análisis completo: ${(ev.results as AnalyzedBug[]).length} bugs procesados`)
    })

    const cleanIndex = api.onIndexProgress((ev: IPCEvent) => {
      if (ev.type !== 'index-progress') return
      const e = ev as IndexProgressEvent
      setIndexProgress({ filesProcessed: e.filesProcessed, totalFiles: e.totalFiles, message: e.message })
    })

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
    setProgress({ current: 0, total: 0, message: 'iniciando...' })
    addLog('info', 'iniciando análisis...')

    const result = await window.electronAPI.runAnalysis(excelPath)
    if (!result.ok) {
      addLog('error', `error: ${result.error}`)
      setPhase('idle')
    }
  }, [excelPath, addLog])

  const handleIndexRepos = useCallback(async () => {
    setIsIndexing(true)
    setIndexProgress({ filesProcessed: 0, totalFiles: 0, message: 'iniciando indexación...' })
    addLog('info', 'iniciando indexación de repos...')

    const result = await window.electronAPI.indexRepos()
    setIsIndexing(false)

    if (result.ok) {
      setHasIndex(true)
      addLog('info', 'repos indexados correctamente')
    } else {
      addLog('error', `error al indexar: ${result.error}`)
    }
  }, [addLog])

  const handleExport = useCallback(async () => {
    if (!excelPath || results.length === 0) return
    const result = await window.electronAPI.exportExcel(excelPath, results)
    if (result.ok) {
      addLog('info', `exportado: ${result.filePath}`)
    } else if (result.error) {
      addLog('error', `error al exportar: ${result.error}`)
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
    <div className="flex flex-col h-screen bg-om-base text-om-fg">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-2.5 bg-om-surface border-b border-om-border/25 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-om-fgmuted font-mono text-sm tracking-tight">
            <span className="text-om-accent">~/</span>buglens
          </span>
          {hasIndex && (
            <span className="text-xs text-om-fgmuted border border-om-border/30 px-2 py-0.5 rounded font-mono">
              idx
            </span>
          )}
        </div>

        <nav className="flex gap-1">
          {(['main', 'settings'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                tab === t
                  ? 'bg-om-accent text-om-base font-semibold'
                  : 'text-om-muted hover:text-om-fg hover:bg-om-raised'
              }`}
            >
              {t === 'main' ? 'main' : 'config'}
            </button>
          ))}
        </nav>
      </header>

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
            <div className="w-72 flex-shrink-0 flex flex-col gap-3 p-4 border-r border-om-border/20 overflow-y-auto">
              <FileUpload
                excelPath={excelPath}
                onFileSelected={setExcelPath}
                disabled={phase === 'analyzing'}
              />

              {phase === 'idle' && (
                <button
                  className="btn-primary w-full"
                  onClick={handleAnalyze}
                  disabled={!excelPath}
                >
                  analizar bugs
                </button>
              )}

              {phase === 'analyzing' && (
                <div className="card">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-1.5 h-1.5 bg-om-accent rounded-full animate-pulse flex-shrink-0" />
                    <span className="text-xs text-om-fgmuted flex-1 truncate font-mono">{progress.message}</span>
                  </div>
                  <div className="w-full bg-om-dim/40 rounded-full h-0.5">
                    <div
                      className="bg-om-accent h-0.5 rounded-full transition-all duration-500"
                      style={{
                        width: progress.total > 0
                          ? `${(progress.current / progress.total) * 100}%`
                          : '5%',
                      }}
                    />
                  </div>
                  {progress.total > 0 && (
                    <div className="text-xs text-om-muted mt-1.5 font-mono text-right">
                      {progress.current}/{progress.total}
                    </div>
                  )}
                  <button
                    onClick={() => setShowLogs((v) => !v)}
                    className="text-xs text-om-muted hover:text-om-fgmuted mt-2 w-full text-left font-mono transition-colors"
                  >
                    {showLogs ? '▼ log' : '▶ log'}
                  </button>
                </div>
              )}

              {phase === 'done' && (
                <div className="flex flex-col gap-2">
                  <button className="btn-primary w-full" onClick={handleExport}>
                    exportar excel
                  </button>
                  <button className="btn-secondary w-full" onClick={handleReset}>
                    nuevo análisis
                  </button>
                </div>
              )}

              {phase === 'done' && results.length > 0 && (
                <div className="card">
                  <div className="section-label">resumen</div>
                  <StatsGrid results={results} />
                </div>
              )}
            </div>

            {/* Right panel */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {results.length > 0 ? (
                <div className="flex flex-col h-full">
                  <div className="flex-1 overflow-hidden">
                    <BugTable results={results} analyzing={phase === 'analyzing'} />
                  </div>
                  {showLogs && (
                    <div className="h-40 flex-shrink-0 border-t border-om-border/20">
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

  const severityColor: Record<string, string> = {
    critical: 'text-om-red',
    high:     'text-[#c9a07a]',
    medium:   'text-om-cream',
    low:      'text-om-fgdim',
  }

  return (
    <div className="space-y-1 text-xs font-mono">
      {Object.entries(counts.severities).sort().map(([s, n]) => (
        <div key={s} className="flex justify-between">
          <span className={severityColor[s] ?? 'text-om-fgmuted'}>{s}</span>
          <span className="text-om-fg">{n}</span>
        </div>
      ))}
      <div className="border-t border-om-border/20 pt-1.5 mt-1.5">
        {Object.entries(counts.categories).sort().map(([c, n]) => (
          <div key={c} className="flex justify-between">
            <span className="text-om-fgmuted">{c}</span>
            <span className="text-om-fg">{n}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
