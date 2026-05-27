import React, { useState, useMemo } from 'react'
import type { AnalyzedBug, BugCategory, Severity, DocImage, EvidenceSource } from '../../src/types/index'

interface Props {
  results: AnalyzedBug[]
  analyzing?: boolean
}

const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }

const severityBadge: Record<Severity, string> = {
  critical: 'badge-severity-critical',
  high:     'badge-severity-high',
  medium:   'badge-severity-medium',
  low:      'badge-severity-low',
}

const categoryColors: Record<BugCategory, string> = {
  frontend:          'text-cyan-400 bg-cyan-950 border-cyan-800',
  backend:           'text-violet-400 bg-violet-950 border-violet-800',
  database:          'text-orange-400 bg-orange-950 border-orange-800',
  config:            'text-yellow-400 bg-yellow-950 border-yellow-800',
  data:              'text-pink-400 bg-pink-950 border-pink-800',
  insufficient_info: 'text-gray-400 bg-gray-900 border-gray-700',
}

const difficultyStyle: Record<string, { label: string; color: string }> = {
  low:    { label: 'Fácil',   color: 'text-green-400 bg-green-950 border-green-800' },
  medium: { label: 'Medio',   color: 'text-amber-400 bg-amber-950 border-amber-800' },
  high:   { label: 'Difícil', color: 'text-red-400 bg-red-950 border-red-800' },
}

const evidenceStyle: Record<EvidenceSource, { label: string; color: string }> = {
  excel:      { label: 'Excel',      color: 'text-green-300 bg-green-950 border-green-800' },
  document:   { label: 'Documento',  color: 'text-blue-300 bg-blue-950 border-blue-800' },
  screenshot: { label: 'Captura',    color: 'text-purple-300 bg-purple-950 border-purple-800' },
  code:       { label: 'Código',     color: 'text-indigo-300 bg-indigo-950 border-indigo-800' },
  inference:  { label: 'Inferencia', color: 'text-amber-300 bg-amber-950 border-amber-800' },
  missing:    { label: 'Falta',      color: 'text-red-300 bg-red-950 border-red-800' },
}

// ─── Small atoms ─────────────────────────────────────────────────────────────

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${className}`}>
      {children}
    </span>
  )
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 bg-gray-800 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400">{pct}%</span>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="text-xs px-1.5 py-0.5 rounded border border-gray-700 hover:border-gray-500 text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}

function SectionCard({ title, children, accent = false }: { title: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${accent ? 'border-indigo-800 bg-indigo-950/20' : 'border-gray-800 bg-gray-900/40'}`}>
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{title}</div>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-600 uppercase tracking-wider mb-0.5">{label}</div>
      <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{value}</p>
    </div>
  )
}

// ─── Code block ───────────────────────────────────────────────────────────────

function CodeBlock({ filePath, startLine, content, score }: {
  filePath: string; startLine: number; endLine: number; content: string; score: number
}) {
  const [expanded, setExpanded] = useState(false)
  const fileName = filePath.split(/[\\/]/).slice(-2).join('/')
  const lines = content.split('\n')
  const displayed = expanded ? lines : lines.slice(0, 12)

  return (
    <div className="rounded-lg border border-gray-800 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-800">
        <span className="font-mono text-xs text-indigo-300 flex-1 truncate">{fileName}</span>
        <span className="text-xs text-gray-600">match {Math.round(score * 100)}%</span>
        <CopyButton text={content} />
      </div>
      <div className="relative">
        <pre className="text-xs text-gray-300 p-3 overflow-x-auto bg-gray-950 leading-relaxed">
          {displayed.map((line, i) => (
            <div key={i} className="flex gap-3">
              <span className="select-none text-gray-700 w-6 text-right flex-shrink-0">{startLine + i}</span>
              <span>{line}</span>
            </div>
          ))}
        </pre>
        {!expanded && lines.length > 12 && (
          <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-gray-950 to-transparent flex items-end justify-center pb-1">
            <button onClick={() => setExpanded(true)} className="text-xs text-indigo-400 hover:text-indigo-300">
              + {lines.length - 12} líneas más
            </button>
          </div>
        )}
        {expanded && lines.length > 12 && (
          <div className="flex justify-center py-1 bg-gray-950 border-t border-gray-800">
            <button onClick={() => setExpanded(false)} className="text-xs text-gray-600 hover:text-gray-400">Colapsar</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── BugTable ─────────────────────────────────────────────────────────────────

export default function BugTable({ results, analyzing = false }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterCategory, setFilterCategory] = useState<BugCategory | 'all'>('all')
  const [filterSeverity, setFilterSeverity] = useState<Severity | 'all'>('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    return results
      .filter((r) => {
        if (filterCategory !== 'all' && r.analysis.category !== filterCategory) return false
        if (filterSeverity !== 'all' && r.analysis.severity !== filterSeverity) return false
        if (search) {
          const q = search.toLowerCase()
          return (
            r.enriched.raw.title.toLowerCase().includes(q) ||
            r.analysis.probableCause.toLowerCase().includes(q) ||
            r.analysis.summary.toLowerCase().includes(q) ||
            (r.analysis.affectedArea?.toLowerCase().includes(q) ?? false)
          )
        }
        return true
      })
      .sort((a, b) => severityOrder[a.analysis.severity] - severityOrder[b.analysis.severity])
  }, [results, filterCategory, filterSeverity, search])

  const categories = useMemo(() => [...new Set(results.map((r) => r.analysis.category))], [results])
  const severities  = useMemo(() => [...new Set(results.map((r) => r.analysis.severity))],  [results])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 flex-wrap flex-shrink-0">
        <input
          type="text" placeholder="Buscar bugs..."
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="input text-sm w-52"
        />
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value as BugCategory | 'all')} className="input text-sm w-36">
          <option value="all">Categoría</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value as Severity | 'all')} className="input text-sm w-36">
          <option value="all">Severidad</option>
          {severities.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-xs text-gray-500 ml-auto flex items-center gap-2">
          {analyzing && (
            <span className="flex items-center gap-1 text-indigo-400">
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse" />
              analizando...
            </span>
          )}
          {filtered.length} de {results.length} bugs
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-950 border-b border-gray-800 z-10">
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-4 py-2 font-medium">Título</th>
              <th className="px-4 py-2 font-medium">Área afectada</th>
              <th className="px-4 py-2 font-medium">Categoría</th>
              <th className="px-4 py-2 font-medium">Severidad</th>
              <th className="px-4 py-2 font-medium">Fix</th>
              <th className="px-4 py-2 font-medium">Confianza</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const id = r.enriched.raw.id
              const isExpanded = expandedId === id
              const diff = difficultyStyle[r.analysis.difficulty] ?? difficultyStyle['medium']

              return (
                <React.Fragment key={id}>
                  <tr
                    onClick={() => setExpandedId(isExpanded ? null : id)}
                    className={`border-b border-gray-800 cursor-pointer transition-colors ${isExpanded ? 'bg-gray-900' : 'hover:bg-gray-900/50'}`}
                  >
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">{r.enriched.raw.rowIndex}</td>
                    <td className="px-4 py-3 max-w-xs">
                      <div className="font-medium text-gray-100 truncate">{r.enriched.raw.title}</div>
                      <div className="text-xs text-gray-500 truncate mt-0.5">{r.analysis.summary}</div>
                      {r.analysis.needsMoreInfo && <span className="text-xs text-amber-500">⚠ Necesita más info</span>}
                    </td>
                    <td className="px-4 py-3 max-w-[180px]">
                      <div className="text-xs text-gray-400 font-mono truncate" title={r.analysis.affectedArea}>
                        {r.analysis.affectedArea || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3"><Badge className={categoryColors[r.analysis.category]}>{r.analysis.category}</Badge></td>
                    <td className="px-4 py-3"><Badge className={severityBadge[r.analysis.severity]}>{r.analysis.severity}</Badge></td>
                    <td className="px-4 py-3"><Badge className={diff.color}>{diff.label}</Badge></td>
                    <td className="px-4 py-3"><ConfidenceBar value={r.analysis.confidence} /></td>
                  </tr>

                  {isExpanded && (
                    <tr className="bg-gray-900/30">
                      <td colSpan={7} className="p-0">
                        <ExpandedDetail result={r} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="text-center text-gray-600 py-16">No hay bugs que coincidan con los filtros</div>
        )}
      </div>
    </div>
  )
}

// ─── Expanded detail ──────────────────────────────────────────────────────────

function ExpandedDetail({ result }: { result: AnalyzedBug }) {
  const { enriched, analysis } = result
  const raw = enriched.raw
  const diff = difficultyStyle[analysis.difficulty] ?? difficultyStyle['medium']
  const allImages = enriched.googleDocs.flatMap((d) => d.images ?? [])

  return (
    <div className="border-t border-gray-800">
      {/* Header strip */}
      <div className="flex items-start gap-4 px-6 py-4 bg-gray-900 border-b border-gray-800">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-100 text-base mb-1">{raw.title}</div>
          <div className="text-sm text-gray-400">{analysis.summary}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge className={categoryColors[analysis.category]}>{analysis.category}</Badge>
          <Badge className={severityBadge[analysis.severity]}>{analysis.severity}</Badge>
          <Badge className={diff.color}>{diff.label}</Badge>
          <div className="ml-2"><ConfidenceBar value={analysis.confidence} /></div>
        </div>
      </div>

      <div className="p-6 space-y-4">

        {/* Row 1: Área afectada + razones de clasificación */}
        <div className="grid grid-cols-2 gap-4">
          {analysis.affectedArea && (
            <SectionCard title="🎯 Área afectada" accent>
              <div className="flex items-start gap-2">
                <code className="text-sm text-indigo-300 font-mono break-all flex-1">{analysis.affectedArea}</code>
                <CopyButton text={analysis.affectedArea} />
              </div>
            </SectionCard>
          )}

          <SectionCard title="🏷 Por qué esta clasificación">
            {analysis.classificationReason ? (
              <p className="text-sm text-gray-300 leading-relaxed">{analysis.classificationReason}</p>
            ) : (
              <p className="text-sm text-gray-600 italic">Sin información</p>
            )}
            {analysis.confidenceReason && (
              <p className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-800 leading-relaxed">
                <span className="text-gray-600">Confianza: </span>{analysis.confidenceReason}
              </p>
            )}
          </SectionCard>
        </div>

        {/* Row 2: Causa probable */}
        <SectionCard title="🔍 Causa probable">
          <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{analysis.probableCause}</div>
        </SectionCard>

        {/* Row 3: Evidencia usada */}
        {analysis.evidenceUsed && analysis.evidenceUsed.length > 0 && (
          <SectionCard title="📎 Evidencia usada">
            <div className="space-y-2">
              {analysis.evidenceUsed.map((ev, i) => {
                const style = evidenceStyle[ev.source] ?? evidenceStyle['inference']
                return (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border flex-shrink-0 mt-0.5 ${style.color}`}>
                      {style.label}
                    </span>
                    <span className="text-sm text-gray-300 leading-relaxed">{ev.description}</span>
                  </div>
                )
              })}
            </div>
            {allImages.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-800">
                <div className="text-xs text-gray-600 mb-2">{allImages.length} captura{allImages.length > 1 ? 's' : ''} del documento</div>
                <DocImageGallery images={allImages} />
              </div>
            )}
          </SectionCard>
        )}

        {/* Row 4: Fix + Investigación side by side */}
        <div className="grid grid-cols-2 gap-4">
          {analysis.suggestedFixSteps && analysis.suggestedFixSteps.length > 0 && (
            <SectionCard title="🛠 Fix sugerido">
              <ol className="space-y-2">
                {analysis.suggestedFixSteps.map((step, i) => (
                  <li key={i} className="flex gap-2.5 text-sm">
                    <span className="flex-shrink-0 w-5 h-5 rounded bg-indigo-900 border border-indigo-700 text-indigo-300 text-xs flex items-center justify-center font-medium mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-gray-300 leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </SectionCard>
          )}

          {analysis.investigationSteps && analysis.investigationSteps.length > 0 && (
            <SectionCard title="📋 Pasos de investigación">
              <ol className="space-y-2">
                {analysis.investigationSteps.map((step, i) => (
                  <li key={i} className="flex gap-2.5 text-sm">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-800 border border-gray-700 text-gray-400 text-xs flex items-center justify-center font-medium mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-gray-300 leading-relaxed">{step.replace(/^Paso \d+:\s*/i, '')}</span>
                  </li>
                ))}
              </ol>
            </SectionCard>
          )}
        </div>

        {/* Row 5: Archivos relacionados con motivo */}
        {analysis.relatedFilesWithReasons && analysis.relatedFilesWithReasons.length > 0 && (
          <SectionCard title="📁 Archivos relacionados">
            <div className="space-y-2">
              {analysis.relatedFilesWithReasons.map((f, i) => (
                <div key={i} className="rounded-lg border border-gray-800 bg-gray-950 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-xs text-indigo-300 font-mono flex-1 break-all">{f.path}</code>
                    <CopyButton text={f.path} />
                  </div>
                  {f.reason && (
                    <p className="text-xs text-gray-500 leading-relaxed">{f.reason}</p>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Row 6: Qué NO se puede afirmar */}
        {analysis.cannotConclude && analysis.cannotConclude.length > 0 && (
          <SectionCard title="⚠ Qué no se puede afirmar">
            <ul className="space-y-1.5">
              {analysis.cannotConclude.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-amber-600 flex-shrink-0 mt-0.5">✗</span>
                  <span className="text-gray-400">{item.replace(/^Que\s/i, 'Que ')}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        {/* Row 7: Info del reporte original */}
        <details className="group">
          <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400 select-none">
            ▶ Ver reporte original del bug
          </summary>
          <div className="mt-3 rounded-lg border border-gray-800 p-4 space-y-3">
            {raw.description && <Field label="Descripción" value={raw.description} />}
            {raw.stepsToReproduce && <Field label="Pasos para reproducir" value={raw.stepsToReproduce} />}
            {raw.expectedResult && <Field label="Resultado esperado" value={raw.expectedResult} />}
            {raw.actualResult && <Field label="Resultado actual" value={raw.actualResult} />}
            {raw.environment && <Field label="Entorno" value={raw.environment} />}
            {enriched.googleDocs.length > 0 && (
              <div>
                <div className="text-xs text-gray-600 uppercase tracking-wider mb-1">Documentos</div>
                {enriched.googleDocs.map((doc, i) => (
                  <div key={i} className="text-xs">
                    {doc.accessible
                      ? <span className="text-green-400">✓ {doc.title}</span>
                      : <span className="text-red-400">✗ {doc.url} — {doc.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>

        {/* Error */}
        {result.error && (
          <div className="bg-red-950/50 border border-red-800 rounded-lg p-3">
            <div className="text-xs text-red-400 font-medium mb-1">Error durante el análisis</div>
            <div className="text-xs text-red-300">{result.error}</div>
          </div>
        )}
      </div>

      {/* Code fragments — full width al pie */}
      {enriched.codeFragments.length > 0 && (
        <div className="border-t border-gray-800 px-6 py-5">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            💻 Código fuente encontrado en el repo
            <span className="ml-2 text-gray-700 font-normal">({enriched.codeFragments.length} fragmento{enriched.codeFragments.length > 1 ? 's' : ''})</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {enriched.codeFragments.map((frag, i) => (
              <CodeBlock key={i} {...frag} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Image gallery ────────────────────────────────────────────────────────────

function DocImageGallery({ images }: { images: DocImage[] }) {
  const [lightbox, setLightbox] = useState<DocImage | null>(null)

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {images.map((img, i) => (
          <button
            key={i}
            onClick={() => setLightbox(img)}
            className="group relative border border-gray-700 rounded-lg overflow-hidden hover:border-indigo-500 transition-colors bg-gray-900"
          >
            <img
              src={`data:${img.mimeType};base64,${img.data}`}
              alt={img.alt || `Imagen ${i + 1}`}
              className="h-20 w-auto max-w-[140px] object-contain"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-end justify-center pb-1 opacity-0 group-hover:opacity-100">
              <span className="text-xs text-white bg-black/60 px-1.5 py-0.5 rounded">🔍</span>
            </div>
          </button>
        ))}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <div className="relative max-w-5xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={`data:${lightbox.mimeType};base64,${lightbox.data}`}
              alt={lightbox.alt || 'Imagen del documento'}
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
            {lightbox.alt && <div className="mt-2 text-center text-sm text-gray-400">{lightbox.alt}</div>}
            <button
              onClick={() => setLightbox(null)}
              className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm flex items-center justify-center"
            >✕</button>
          </div>
        </div>
      )}
    </>
  )
}
