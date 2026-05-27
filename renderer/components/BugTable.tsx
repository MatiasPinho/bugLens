import React, { useState, useMemo } from 'react'
import type { AnalyzedBug, BugCategory, Severity, DocImage } from '../../src/types/index'

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
  frontend:         'text-cyan-400 bg-cyan-950 border-cyan-800',
  backend:          'text-violet-400 bg-violet-950 border-violet-800',
  database:         'text-orange-400 bg-orange-950 border-orange-800',
  config:           'text-yellow-400 bg-yellow-950 border-yellow-800',
  data:             'text-pink-400 bg-pink-950 border-pink-800',
  insufficient_info:'text-gray-400 bg-gray-900 border-gray-700',
}

const difficultyLabel: Record<string, { label: string; color: string }> = {
  low:    { label: 'Fácil',   color: 'text-green-400 bg-green-950 border-green-800' },
  medium: { label: 'Medio',   color: 'text-amber-400 bg-amber-950 border-amber-800' },
  high:   { label: 'Difícil', color: 'text-red-400 bg-red-950 border-red-800' },
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${className}`}>
      {children}
    </span>
  )
}

// ─── Confidence bar ───────────────────────────────────────────────────────────

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

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={copy}
      className={`text-xs px-1.5 py-0.5 rounded border border-gray-700 hover:border-gray-500
                  text-gray-500 hover:text-gray-300 transition-colors ${className}`}
      title="Copiar"
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}

// ─── Code block ───────────────────────────────────────────────────────────────

function CodeBlock({
  filePath,
  startLine,
  endLine,
  content,
  score,
}: {
  filePath: string
  startLine: number
  endLine: number
  content: string
  score: number
}) {
  const [expanded, setExpanded] = useState(false)
  const fileName = filePath.split(/[\\/]/).slice(-2).join('/')
  const lines = content.split('\n')
  const preview = lines.slice(0, 12)
  const hasMore = lines.length > 12
  const displayed = expanded ? lines : preview

  return (
    <div className="rounded-lg border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-800">
        <span className="font-mono text-xs text-indigo-300 flex-1 truncate">
          {fileName}
          <span className="text-gray-600 ml-1">:{startLine}–{endLine}</span>
        </span>
        <span className="text-xs text-gray-600">
          match {Math.round(score * 100)}%
        </span>
        <CopyButton text={content} />
      </div>
      {/* Code */}
      <div className="relative">
        <pre className="text-xs text-gray-300 p-3 overflow-x-auto bg-gray-950 leading-relaxed">
          {displayed.map((line, i) => (
            <div key={i} className="flex gap-3">
              <span className="select-none text-gray-700 w-6 text-right flex-shrink-0">
                {startLine + i}
              </span>
              <span>{line}</span>
            </div>
          ))}
        </pre>
        {hasMore && !expanded && (
          <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-gray-950 to-transparent
                          flex items-end justify-center pb-1">
            <button
              onClick={() => setExpanded(true)}
              className="text-xs text-indigo-400 hover:text-indigo-300"
            >
              + {lines.length - 12} líneas más
            </button>
          </div>
        )}
        {expanded && hasMore && (
          <div className="flex justify-center py-1 bg-gray-950 border-t border-gray-800">
            <button onClick={() => setExpanded(false)} className="text-xs text-gray-600 hover:text-gray-400">
              Colapsar
            </button>
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
            r.analysis.affectedArea?.toLowerCase().includes(q)
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
      {/* Filters bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 flex-wrap flex-shrink-0">
        <input
          type="text"
          placeholder="Buscar bugs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input text-sm w-52"
        />
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value as BugCategory | 'all')}
          className="input text-sm w-36"
        >
          <option value="all">Categoría</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value as Severity | 'all')}
          className="input text-sm w-36"
        >
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

      {/* Table */}
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
              const diff = difficultyLabel[r.analysis.difficulty] ?? difficultyLabel['medium']

              return (
                <React.Fragment key={id}>
                  <tr
                    onClick={() => setExpandedId(isExpanded ? null : id)}
                    className={`border-b border-gray-800 cursor-pointer transition-colors
                      ${isExpanded ? 'bg-gray-900' : 'hover:bg-gray-900/50'}`}
                  >
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                      {r.enriched.raw.rowIndex}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <div className="font-medium text-gray-100 truncate">{r.enriched.raw.title}</div>
                      <div className="text-xs text-gray-500 truncate mt-0.5">{r.analysis.summary}</div>
                      {r.analysis.needsMoreInfo && (
                        <span className="text-xs text-amber-500">⚠ Necesita más info</span>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-[180px]">
                      <div className="text-xs text-gray-400 font-mono truncate" title={r.analysis.affectedArea}>
                        {r.analysis.affectedArea || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={categoryColors[r.analysis.category]}>
                        {r.analysis.category}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={severityBadge[r.analysis.severity]}>
                        {r.analysis.severity}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={diff.color}>{diff.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <ConfidenceBar value={r.analysis.confidence} />
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr className="bg-gray-900/50">
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
          <div className="text-center text-gray-600 py-16">
            No hay bugs que coincidan con los filtros
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Expanded detail ──────────────────────────────────────────────────────────

function ExpandedDetail({ result }: { result: AnalyzedBug }) {
  const { enriched, analysis } = result
  const raw = enriched.raw
  const diff = difficultyLabel[analysis.difficulty] ?? difficultyLabel['medium']

  const allImages = enriched.googleDocs.flatMap((d) => d.images ?? [])

  return (
    <div className="border-t border-gray-800">
      {/* Top bar: resumen rápido */}
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

      <div className="grid grid-cols-2 gap-0 divide-x divide-gray-800">
        {/* ── LEFT: Bug info ─────────────────────────────────────────────── */}
        <div className="px-6 py-5 space-y-4 overflow-hidden">
          <SectionLabel>📋 Reporte del bug</SectionLabel>

          {raw.description && <Field label="Descripción" value={raw.description} />}
          {raw.stepsToReproduce && <Field label="Pasos para reproducir" value={raw.stepsToReproduce} />}
          {raw.expectedResult && <Field label="Resultado esperado" value={raw.expectedResult} />}
          {raw.actualResult && <Field label="Resultado actual" value={raw.actualResult} />}
          {raw.environment && <Field label="Entorno" value={raw.environment} />}

          {/* Documentos de evidencia */}
          {enriched.googleDocs.length > 0 && (
            <div>
              <SectionLabel>📄 Documentos de evidencia</SectionLabel>
              <div className="space-y-2 mt-2">
                {enriched.googleDocs.map((doc, i) => (
                  <div key={i}>
                    {doc.accessible ? (
                      <div className="text-xs text-green-400 font-medium">✓ {doc.title}</div>
                    ) : (
                      <div className="text-xs text-red-400">✗ {doc.url} — {doc.error}</div>
                    )}
                  </div>
                ))}
              </div>

              {/* Galería de capturas del doc */}
              {allImages.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs text-gray-600 mb-2">
                    {allImages.length} captura{allImages.length > 1 ? 's' : ''} del documento
                  </div>
                  <DocImageGallery images={allImages} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: Analysis ────────────────────────────────────────────── */}
        <div className="px-6 py-5 space-y-5 overflow-hidden">

          {/* Área afectada */}
          {analysis.affectedArea && (
            <div>
              <SectionLabel>🎯 Área afectada</SectionLabel>
              <div className="mt-1 flex items-center gap-2">
                <code className="text-sm text-indigo-300 bg-gray-900 border border-gray-800 rounded px-2 py-1 font-mono flex-1 break-all">
                  {analysis.affectedArea}
                </code>
                <CopyButton text={analysis.affectedArea} />
              </div>
            </div>
          )}

          {/* Causa probable */}
          <div>
            <SectionLabel>🔍 Causa probable</SectionLabel>
            <p className="mt-1 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
              {analysis.probableCause}
            </p>
          </div>

          {/* Fix sugerido */}
          {analysis.suggestedFix && (
            <div>
              <SectionLabel>🛠 Fix sugerido</SectionLabel>
              <div className="mt-1 relative">
                <pre className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap bg-gray-900 border border-gray-800 rounded-lg p-3 pr-8">
                  {analysis.suggestedFix}
                </pre>
                <div className="absolute top-2 right-2">
                  <CopyButton text={analysis.suggestedFix} />
                </div>
              </div>
            </div>
          )}

          {/* Pasos de investigación */}
          {analysis.investigationSteps && analysis.investigationSteps.length > 0 && (
            <div>
              <SectionLabel>📋 Pasos de investigación</SectionLabel>
              <ol className="mt-2 space-y-2">
                {analysis.investigationSteps.map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-900 border border-indigo-700
                                     text-indigo-300 text-xs flex items-center justify-center font-medium">
                      {i + 1}
                    </span>
                    <span className="text-gray-300 leading-relaxed">{step.replace(/^Paso \d+:\s*/i, '')}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Archivos relacionados */}
          {analysis.relatedFiles.length > 0 && (
            <div>
              <SectionLabel>📁 Archivos relacionados</SectionLabel>
              <div className="mt-2 space-y-1">
                {analysis.relatedFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <code className="text-xs text-indigo-300 bg-gray-900 border border-gray-800 rounded px-2 py-1 font-mono flex-1 break-all">
                      {f}
                    </code>
                    <CopyButton text={f} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error si hubo */}
          {result.error && (
            <div className="bg-red-950/50 border border-red-800 rounded-lg p-3">
              <div className="text-xs text-red-400 font-medium mb-1">Error durante el análisis</div>
              <div className="text-xs text-red-300">{result.error}</div>
            </div>
          )}
        </div>
      </div>

      {/* Code fragments — full width below */}
      {enriched.codeFragments.length > 0 && (
        <div className="border-t border-gray-800 px-6 py-5">
          <SectionLabel>
            💻 Código relevante encontrado en el repo
            <span className="ml-2 text-gray-600 font-normal text-xs">
              ({enriched.codeFragments.length} fragmento{enriched.codeFragments.length > 1 ? 's' : ''})
            </span>
          </SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {enriched.codeFragments.map((frag, i) => (
              <CodeBlock key={i} {...frag} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
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
            className="group relative border border-gray-700 rounded-lg overflow-hidden
                       hover:border-indigo-500 transition-colors bg-gray-900"
            title={img.alt || `Imagen ${i + 1}`}
          >
            <img
              src={`data:${img.mimeType};base64,${img.data}`}
              alt={img.alt || `Imagen ${i + 1}`}
              className="h-20 w-auto max-w-[140px] object-contain"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors
                            flex items-end justify-center pb-1 opacity-0 group-hover:opacity-100">
              <span className="text-xs text-white bg-black/60 px-1.5 py-0.5 rounded">🔍</span>
            </div>
          </button>
        ))}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={`data:${lightbox.mimeType};base64,${lightbox.data}`}
              alt={lightbox.alt || 'Imagen del documento'}
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
            {lightbox.alt && (
              <div className="mt-2 text-center text-sm text-gray-400">{lightbox.alt}</div>
            )}
            <button
              onClick={() => setLightbox(null)}
              className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-gray-700
                         hover:bg-gray-600 text-gray-200 text-sm flex items-center justify-center"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  )
}
