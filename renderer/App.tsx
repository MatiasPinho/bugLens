import React, { useState, useEffect, useCallback } from 'react'
import Settings from './components/Settings'
import FileUpload from './components/FileUpload'
import ProgressLog from './components/ProgressLog'
import BugTable from './components/BugTable'
import EmptyState from './components/EmptyState'
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

  // Bug seleccionado vía teclado (para j/k navigation + Enter/d shortcuts).
  // null = nada seleccionado.
  const [focusedBugId, setFocusedBugId] = useState<string | null>(null)
  const [expandedBugId, setExpandedBugId] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const searchInputRef = React.useRef<HTMLInputElement | null>(null)

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

  // ─── Keyboard shortcuts ────────────────────────────────────────────────────
  // j/k: next/prev bug, Enter: expandir, Esc: cerrar, /: focus search, d: deep analysis del bug abierto, ?: help
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignorar si estamos escribiendo en un input/textarea/select
      const target = e.target as HTMLElement
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
      if (isTyping && e.key !== 'Escape') return

      // Solo activos en la tab main
      if (tab !== 'main') return

      switch (e.key) {
        case '?':
          if (e.shiftKey || target.tagName !== 'BODY') return
          e.preventDefault()
          setShowHelp((v) => !v)
          break
        case '/':
          if (results.length === 0) return
          e.preventDefault()
          searchInputRef.current?.focus()
          break
        case 'Escape':
          if (showHelp) { setShowHelp(false); break }
          if (expandedBugId) { setExpandedBugId(null); break }
          if (isTyping) (target as HTMLInputElement).blur()
          break
        case 'j': {
          if (results.length === 0) return
          e.preventDefault()
          const idx = results.findIndex((r) => r.enriched.raw.id === focusedBugId)
          const next = results[Math.min(idx + 1, results.length - 1)] ?? results[0]
          setFocusedBugId(next.enriched.raw.id)
          break
        }
        case 'k': {
          if (results.length === 0) return
          e.preventDefault()
          const idx = results.findIndex((r) => r.enriched.raw.id === focusedBugId)
          const prev = results[Math.max(idx - 1, 0)] ?? results[0]
          setFocusedBugId(prev.enriched.raw.id)
          break
        }
        case 'Enter': {
          if (!focusedBugId) return
          e.preventDefault()
          setExpandedBugId((curr) => (curr === focusedBugId ? null : focusedBugId))
          break
        }
        case 'd': {
          if (!expandedBugId) return
          const bug = results.find((r) => r.enriched.raw.id === expandedBugId)
          if (!bug || bug.analysis.analysisStatus !== 'fast_completed') return
          e.preventDefault()
          handleDeepAnalysis(bug)
          break
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, results, focusedBugId, expandedBugId, showHelp, handleDeepAnalysis])

  return (
    <div className="flex flex-col h-screen bg-om-base text-om-fg">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-om-surface border-b border-om-border/25 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ color: '#c9c2b4', flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="11" cy="11" r="2.5" fill="currentColor" opacity="0.7"/>
          </svg>
          <span className="font-mono text-sm font-semibold tracking-tight" style={{ color: '#c9c2b4' }}>
            buglens
          </span>
          {hasIndex && (
            <span className="text-xs border px-1.5 py-0.5 rounded font-mono"
              style={{ color: '#9fa5a9', borderColor: 'rgba(93,99,103,0.30)' }}>
              idx
            </span>
          )}
        </div>

        <nav className="flex items-center gap-1">
          {(['main', 'settings'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1 rounded text-xs font-mono transition-colors cursor-pointer"
              style={tab === t
                ? { background: 'rgba(201,194,180,0.12)', color: '#c9c2b4', border: '1px solid rgba(201,194,180,0.22)' }
                : { color: '#798186', background: 'transparent', border: '1px solid transparent' }
              }
              onMouseEnter={e => { if (tab !== t) { e.currentTarget.style.color = '#cacccc'; e.currentTarget.style.background = '#1c2124' } }}
              onMouseLeave={e => { if (tab !== t) { e.currentTarget.style.color = '#798186'; e.currentTarget.style.background = 'transparent' } }}
            >
              {t === 'main' ? 'main' : 'config'}
            </button>
          ))}
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="ml-1 w-7 h-7 rounded flex items-center justify-center text-xs font-mono transition-colors cursor-pointer"
            style={{ color: '#798186', border: '1px solid transparent' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#cacccc'; e.currentTarget.style.background = '#1c2124' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#798186'; e.currentTarget.style.background = 'transparent' }}
            title="atajos de teclado (?)"
            aria-label="ayuda"
          >
            ?
          </button>
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
                  {/* Pasos visuales — el segmento activo está iluminado */}
                  <PhaseSteps current={progress.phase} />

                  <div className="flex items-center gap-2 mb-2.5 mt-3">
                    <span className="w-1.5 h-1.5 bg-om-cream rounded-full animate-scan flex-shrink-0" />
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
                    <BugTable
                      results={results}
                      analyzing={phase === 'analyzing'}
                      onDeepAnalysis={handleDeepAnalysis}
                      focusedId={focusedBugId}
                      expandedId={expandedBugId}
                      onFocus={setFocusedBugId}
                      onToggleExpand={(id) => setExpandedBugId((curr) => (curr === id ? null : id))}
                      searchInputRef={searchInputRef}
                    />
                  </div>
                  {showLogs && (
                    <div className="h-40 flex-shrink-0 border-t border-om-border/20">
                      <ProgressLog logs={logs} />
                    </div>
                  )}
                </div>
              ) : phase === 'analyzing' ? (
                <div className="flex-1 overflow-hidden">
                  <ProgressLog logs={logs} />
                </div>
              ) : (
                <div className="flex-1 overflow-hidden">
                  <EmptyState hasExcel={!!excelPath} hasIndex={hasIndex} />
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}

// ─── Help modal ────────────────────────────────────────────────────────────────
// Cheatsheet de atajos. Se abre con `?` y cierra con Esc o click afuera.

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(13,16,19,0.85)' }}
      onClick={onClose}
    >
      <div
        className="rounded p-5 max-w-md w-full"
        style={{ background: '#141719', border: '1px solid rgba(93,99,103,0.30)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-mono uppercase tracking-wider" style={{ color: '#c9c2b4' }}>atajos de teclado</span>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center cursor-pointer transition-colors"
            style={{ color: '#798186' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#cacccc')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#798186')}
            aria-label="cerrar"
          >
            <svg width="11" height="11" viewBox="0 0 10 10" fill="none">
              <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="space-y-1.5">
          <ShortcutRow keys={['j']} label="siguiente bug" />
          <ShortcutRow keys={['k']} label="bug anterior" />
          <ShortcutRow keys={['enter']} label="expandir / colapsar bug" />
          <ShortcutRow keys={['esc']} label="cerrar detalle / modal" />
          <ShortcutRow keys={['/']} label="enfocar búsqueda" />
          <ShortcutRow keys={['d']} label="análisis profundo del bug abierto" />
          <ShortcutRow keys={['?']} label="mostrar / ocultar esta ayuda" />
        </div>
      </div>
    </div>
  )
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-xs font-mono" style={{ color: '#9fa5a9' }}>{label}</span>
      <div className="flex gap-1">
        {keys.map((k, i) => (
          <kbd key={i} className="px-1.5 py-0.5 rounded text-xs font-mono"
            style={{
              background: 'rgba(75,78,85,0.30)',
              border: '1px solid rgba(93,99,103,0.30)',
              color: '#c9c2b4',
              minWidth: '1.4em',
              textAlign: 'center',
            }}>
            {k}
          </kbd>
        ))}
      </div>
    </div>
  )
}

// Pasos visuales del pipeline. Cada chip se ilumina cuando es la fase activa,
// los anteriores quedan en color completado, los futuros en gris.
function PhaseSteps({ current }: { current?: import('../src/types/index').AnalysisPhase }) {
  const steps: Array<{ key: import('../src/types/index').AnalysisPhase; label: string }> = [
    { key: 'reading_excel', label: 'excel' },
    { key: 'reading_docs',  label: 'docs' },
    { key: 'fast_triage',   label: 'triage' },
    { key: 'done',          label: 'listo' },
  ]
  const currentIdx = steps.findIndex((s) => s.key === current)
  // Si la fase no aplica (todavía no se emitió), asumimos arrancando en 0
  const activeIdx = currentIdx >= 0 ? currentIdx : 0

  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => {
        const isPast    = i < activeIdx
        const isCurrent = i === activeIdx && current !== 'done'
        const isDone    = current === 'done' || isPast
        const color = isCurrent ? '#c9c2b4' : isDone ? '#9fa5a9' : '#343d41'
        return (
          <div key={s.key} className="flex items-center flex-1 min-w-0 gap-1">
            <div className="flex-1 h-0.5 rounded-full" style={{ background: color, opacity: isCurrent ? 1 : isDone ? 0.6 : 0.3 }} />
            <span className="text-xs font-mono uppercase tracking-wider flex-shrink-0" style={{ color }}>
              {s.label}
            </span>
          </div>
        )
      })}
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
