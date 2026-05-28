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
  const [progress, setProgress] = useState<{ current: number; total: number; message: string; phase?: import('../src/types/index').AnalysisPhase }>({ current: 0, total: 0, message: '' })
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
      setProgress({ current: e.current, total: e.total, message: e.message, phase: e.phase })
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

  // Deep analysis bajo demanda: marca el bug como 'deep_pending',
  // dispara el IPC, y reemplaza el análisis cuando vuelve.
  const handleDeepAnalysis = useCallback(async (bug: AnalyzedBug) => {
    const bugId = bug.enriched.raw.id

    setResults((prev) => prev.map((r) =>
      r.enriched.raw.id === bugId
        ? { ...r, analysis: { ...r.analysis, analysisStatus: 'deep_pending' as const } }
        : r
    ))
    addLog('info', `deep analysis iniciado: ${bug.enriched.raw.title}`)

    const result = await window.electronAPI.deepAnalysis(bug)

    if (result.ok && result.result) {
      setResults((prev) => prev.map((r) =>
        r.enriched.raw.id === bugId ? result.result! : r
      ))
      addLog('info', `deep analysis completo: ${bug.enriched.raw.title}`)
    } else {
      // Revertir al estado fast_completed en error
      setResults((prev) => prev.map((r) =>
        r.enriched.raw.id === bugId
          ? { ...r, analysis: { ...r.analysis, analysisStatus: 'fast_completed' as const } }
          : r
      ))
      addLog('error', `deep analysis falló: ${result.error}`)
    }
  }, [addLog])

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
              className={`px-3 py-1 rounded text-xs font-mono transition-colors cursor-pointer ${
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
                  {progress.phase && (
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-xs font-mono uppercase tracking-wider" style={{ color: '#c9c2b4' }}>
                        {progress.phase === 'reading_excel' ? 'leyendo excel'
                          : progress.phase === 'reading_docs' ? 'leyendo docs'
                          : progress.phase === 'fast_triage' ? 'triage rápido'
                          : progress.phase === 'done' ? 'completado'
                          : 'error'}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="w-1.5 h-1.5 bg-om-cream rounded-full animate-pulse flex-shrink-0" />
                    <span className="text-xs text-om-fgmuted flex-1 truncate font-mono">{progress.message}</span>
                  </div>
                  <div className="w-full rounded-full h-1" style={{ background: 'rgba(75,78,85,0.35)' }}>
                    <div
                      className="h-1 rounded-full transition-all duration-500"
                      style={{
                        background: '#c9c2b4',
                        width: progress.total > 0
                          ? `${(progress.current / progress.total) * 100}%`
                          : '5%',
                      }}
                    />
                  </div>
                  {progress.total > 0 && (
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-xs font-mono" style={{ color: '#343d41' }}>
                        {Math.round((progress.current / progress.total) * 100)}%
                      </span>
                      <span className="text-xs text-om-muted font-mono">
                        {progress.current}/{progress.total}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => setShowLogs((v) => !v)}
                    className="flex items-center gap-1.5 text-xs font-mono mt-2.5 w-full transition-colors cursor-pointer"
                    style={{ color: showLogs ? '#798186' : '#4b4e55' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#798186')}
                    onMouseLeave={e => (e.currentTarget.style.color = showLogs ? '#798186' : '#4b4e55')}
                  >
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"
                      style={{ transform: showLogs ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                      <path d="M2 1l4 3-4 3V1z"/>
                    </svg>
                    log
                    {logs.length > 0 && (
                      <span style={{ color: '#343d41' }}>({logs.length})</span>
                    )}
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
                  <div className="flex items-center justify-between mb-2">
                    <div className="section-label mb-0">resumen</div>
                    <span className="text-xs font-mono" style={{ color: '#798186' }}>{results.length} bugs</span>
                  </div>
                  <StatsGrid results={results} />
                </div>
              )}
            </div>

            {/* Right panel */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {results.length > 0 ? (
                <div className="flex flex-col h-full">
                  <div className="flex-1 overflow-hidden">
                    <BugTable results={results} analyzing={phase === 'analyzing'} onDeepAnalysis={handleDeepAnalysis} />
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
