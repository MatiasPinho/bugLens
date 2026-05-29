import React, { useState, useMemo } from 'react'
import type { AnalyzedBug, BugCategory, Severity, DocImage, EvidenceSource } from '../../src/types/index'

interface Props {
  results: AnalyzedBug[]
  analyzing?: boolean
  onDeepAnalysis?: (bug: AnalyzedBug) => void
}

const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }

// Omarchy-palette badge classes — defined as inline styles to avoid Tailwind purge issues with dynamic values
const severityStyle: Record<Severity, { text: string; bg: string; border: string }> = {
  critical: { text: '#de6145', bg: 'rgba(222,97,69,0.10)',  border: 'rgba(222,97,69,0.30)' },
  high:     { text: '#c9a07a', bg: 'rgba(180,130,100,0.10)', border: 'rgba(180,130,100,0.28)' },
  medium:   { text: '#c9c2b4', bg: 'rgba(201,194,180,0.08)', border: 'rgba(201,194,180,0.20)' },
  low:      { text: '#9fa5a9', bg: 'rgba(159,165,169,0.08)', border: 'rgba(159,165,169,0.18)' },
}

const categoryStyle: Record<BugCategory, { text: string; bg: string; border: string }> = {
  frontend:          { text: '#9fa5a9', bg: 'rgba(159,165,169,0.08)', border: 'rgba(159,165,169,0.20)' },
  backend:           { text: '#798186', bg: 'rgba(121,129,134,0.08)', border: 'rgba(121,129,134,0.22)' },
  database:          { text: '#c9c2b4', bg: 'rgba(201,194,180,0.08)', border: 'rgba(201,194,180,0.18)' },
  config:            { text: '#aeaeae', bg: 'rgba(174,174,174,0.08)', border: 'rgba(174,174,174,0.18)' },
  data:              { text: '#d9dbdc', bg: 'rgba(217,219,220,0.06)', border: 'rgba(217,219,220,0.16)' },
  insufficient_info: { text: '#4b4e55', bg: 'rgba(75,78,85,0.08)',   border: 'rgba(75,78,85,0.20)' },
}

const difficultyStyle: Record<string, { label: string; text: string; bg: string; border: string }> = {
  low:    { label: 'fácil',   text: '#9fa5a9', bg: 'rgba(159,165,169,0.08)', border: 'rgba(159,165,169,0.18)' },
  medium: { label: 'medio',   text: '#c9c2b4', bg: 'rgba(201,194,180,0.08)', border: 'rgba(201,194,180,0.18)' },
  high:   { label: 'difícil', text: '#de6145', bg: 'rgba(222,97,69,0.08)',   border: 'rgba(222,97,69,0.22)' },
}

const evidenceStyle: Record<EvidenceSource, { label: string; text: string; border: string }> = {
  excel:         { label: 'excel',         text: '#9fa5a9', border: 'rgba(159,165,169,0.30)' },
  document:      { label: 'doc',           text: '#c9c2b4', border: 'rgba(201,194,180,0.30)' },
  screenshot:    { label: 'captura',       text: '#aeaeae', border: 'rgba(174,174,174,0.30)' },
  code:          { label: 'código',        text: '#798186', border: 'rgba(121,129,134,0.35)' },
  inference:     { label: 'inferencia',    text: '#c9a07a', border: 'rgba(180,130,100,0.30)' },
  missing:       { label: 'falta',         text: '#de6145', border: 'rgba(222,97,69,0.30)' },
  not_confirmed: { label: 'no confirmado', text: '#c9a07a', border: 'rgba(180,130,100,0.30)' },
}

const strengthStyle: Record<string, { label: string; text: string }> = {
  strong: { label: 'fuerte', text: '#9fa5a9' },
  medium: { label: 'media',  text: '#c9c2b4' },
  weak:   { label: 'débil',  text: '#c9a07a' },
}

const relationStyle: Record<string, string> = {
  route:         '#9fa5a9',
  configuration: '#c9c2b4',
  component:     '#798186',
  template:      '#aeaeae',
  service:       '#798186',
  style:         '#c9c2b4',
  model:         '#9fa5a9',
  inference:     '#c9a07a',
}

// ─── Atoms ────────────────────────────────────────────────────────────────────

function OmBadge({ style, children }: { style: { text: string; bg: string; border: string }; children: React.ReactNode }) {
  return (
    <span style={{ color: style.text, background: style.bg, border: `1px solid ${style.border}` }}
      className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono">
      {children}
    </span>
  )
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 80 ? '#9fa5a9' : pct >= 50 ? '#c9c2b4' : '#de6145'
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 rounded-full h-1" style={{ background: 'rgba(75,78,85,0.40)' }}>
        <div className="h-1 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-mono w-8 text-right" style={{ color: '#5d6367' }}>{pct}%</span>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="flex-shrink-0 transition-colors cursor-pointer"
      title="copiar"
      style={{
        color: copied ? '#9fa5a9' : '#4b4e55',
        border: `1px solid ${copied ? 'rgba(159,165,169,0.35)' : 'rgba(93,99,103,0.25)'}`,
        background: 'transparent',
        borderRadius: '4px',
        padding: '0.2rem 0.4rem',
        fontSize: '0.65rem',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => { if (!copied) e.currentTarget.style.color = '#798186' }}
      onMouseLeave={e => { if (!copied) e.currentTarget.style.color = '#4b4e55' }}
    >
      {copied ? '✓' : 'copy'}
    </button>
  )
}

function SectionCard({ title, children, accent = false }: { title: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <div className={accent ? 'section-card-accent' : 'section-card'}>
      <div className="section-label">{title}</div>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: '#9fa5a9' }}>{value}</p>
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
    <div className="code-block">
      <div className="code-block-header">
        <span className="text-xs font-mono flex-1 truncate" style={{ color: '#798186' }}>{fileName}</span>
        <span className="text-xs font-mono" style={{ color: '#343d41' }}>match {Math.round(score * 100)}%</span>
        <CopyButton text={content} />
      </div>
      <div className="relative">
        <pre className="text-xs p-3 overflow-x-auto leading-relaxed" style={{ color: '#9fa5a9', background: '#0d1013' }}>
          {displayed.map((line, i) => (
            <div key={i} className="flex gap-3">
              <span className="select-none w-6 text-right flex-shrink-0" style={{ color: '#343d41' }}>{startLine + i}</span>
              <span>{line}</span>
            </div>
          ))}
        </pre>
        {!expanded && lines.length > 12 && (
          <div className="absolute bottom-0 left-0 right-0 h-8 flex items-end justify-center pb-1"
            style={{ background: 'linear-gradient(to top, #0d1013, transparent)' }}>
            <button onClick={() => setExpanded(true)}
              className="text-xs font-mono transition-colors"
              style={{ color: '#4b4e55' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#798186')}
              onMouseLeave={e => (e.currentTarget.style.color = '#4b4e55')}>
              + {lines.length - 12} líneas
            </button>
          </div>
        )}
        {expanded && lines.length > 12 && (
          <div className="flex justify-center py-1 border-t" style={{ borderColor: 'rgba(93,99,103,0.22)', background: '#0d1013' }}>
            <button onClick={() => setExpanded(false)}
              className="text-xs font-mono transition-colors"
              style={{ color: '#4b4e55' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#798186')}
              onMouseLeave={e => (e.currentTarget.style.color = '#4b4e55')}>
              colapsar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── BugTable ─────────────────────────────────────────────────────────────────

export default function BugTable({ results, analyzing = false, onDeepAnalysis }: Props) {
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
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap flex-shrink-0"
        style={{ borderColor: 'rgba(93,99,103,0.20)', background: '#101315' }}>
        <div className="relative">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none"
            width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ color: '#4b4e55' }}>
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <input
            type="text" placeholder="buscar bugs..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="input text-xs w-44"
            style={{ paddingLeft: '1.5rem' }}
          />
        </div>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value as BugCategory | 'all')}
          className="input text-xs w-32 cursor-pointer">
          <option value="all">categoría</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value as Severity | 'all')}
          className="input text-xs w-32 cursor-pointer">
          <option value="all">severidad</option>
          {severities.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {(search || filterCategory !== 'all' || filterSeverity !== 'all') && (
          <button
            onClick={() => { setSearch(''); setFilterCategory('all'); setFilterSeverity('all') }}
            className="text-xs font-mono transition-colors cursor-pointer"
            style={{ color: '#4b4e55' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#798186')}
            onMouseLeave={e => (e.currentTarget.style.color = '#4b4e55')}
          >
            limpiar
          </button>
        )}
        <span className="text-xs font-mono ml-auto flex items-center gap-2.5" style={{ color: '#4b4e55' }}>
          {analyzing && (
            <span className="flex items-center gap-1.5" style={{ color: '#9fa5a9' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#c9c2b4' }} />
              analizando
            </span>
          )}
          <span>
            {filtered.length !== results.length
              ? <><span style={{ color: '#798186' }}>{filtered.length}</span><span style={{ color: '#343d41' }}>/{results.length}</span></>
              : <span style={{ color: '#4b4e55' }}>{results.length} bugs</span>
            }
          </span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10" style={{ background: '#101315', borderBottom: '1px solid rgba(93,99,103,0.20)' }}>
            <tr style={{ color: '#5d6367' }} className="text-left font-mono uppercase tracking-wider">
              <th className="px-4 py-2 font-medium w-8">#</th>
              <th className="px-4 py-2 font-medium">título</th>
              <th className="px-4 py-2 font-medium">área</th>
              <th className="px-4 py-2 font-medium">categoría</th>
              <th className="px-4 py-2 font-medium">severidad</th>
              <th className="px-4 py-2 font-medium">fix</th>
              <th className="px-4 py-2 font-medium">confianza</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const id = r.enriched.raw.id
              const isExpanded = expandedId === id
              const diff = difficultyStyle[r.analysis.difficulty] ?? difficultyStyle['medium']
              const sv = severityStyle[r.analysis.severity]
              const ct = categoryStyle[r.analysis.category]

              return (
                <React.Fragment key={id}>
                  <tr
                    onClick={() => setExpandedId(isExpanded ? null : id)}
                    className="cursor-pointer"
                    style={{
                      borderBottom: '1px solid rgba(93,99,103,0.12)',
                      background: isExpanded ? '#141719' : 'transparent',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'rgba(28,33,36,0.80)' }}
                    onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent' }}
                  >
                    <td className="px-4 py-2.5 font-mono" style={{ color: '#343d41' }}>{r.enriched.raw.rowIndex}</td>
                    <td className="px-4 py-2.5 max-w-xs">
                      <div className="font-medium truncate" style={{ color: '#cacccc' }}>{r.enriched.raw.title}</div>
                      <div className="truncate mt-0.5 font-mono" style={{ color: '#4b4e55' }}>{r.analysis.summary}</div>
                      {r.analysis.needsMoreInfo && (
                        <span className="text-xs font-mono" style={{ color: '#c9a07a' }}>⚠ más info</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 max-w-[160px]">
                      <div className="font-mono truncate" style={{ color: '#4b4e55' }} title={r.analysis.affectedArea}>
                        {r.analysis.affectedArea || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5"><OmBadge style={ct}>{r.analysis.category}</OmBadge></td>
                    <td className="px-4 py-2.5"><OmBadge style={sv}>{r.analysis.severity}</OmBadge></td>
                    <td className="px-4 py-2.5">
                      <OmBadge style={{ text: diff.text, bg: diff.bg, border: diff.border }}>{diff.label}</OmBadge>
                    </td>
                    <td className="px-4 py-2.5"><ConfidenceBar value={r.analysis.confidence} /></td>
                  </tr>

                  {isExpanded && (
                    <tr>
                      <td colSpan={7} className="p-0">
                        <ExpandedDetail result={r} onDeepAnalysis={onDeepAnalysis} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{ color: '#343d41' }}>
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.2"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="8" y1="11" x2="14" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <span className="text-xs font-mono" style={{ color: '#4b4e55' }}>
              {results.length > 0 ? 'sin resultados para estos filtros' : 'sin bugs analizados'}
            </span>
            {results.length > 0 && (
              <button
                onClick={() => { setSearch(''); setFilterCategory('all'); setFilterSeverity('all') }}
                className="text-xs font-mono transition-colors cursor-pointer"
                style={{ color: '#5d6367' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#798186')}
                onMouseLeave={e => (e.currentTarget.style.color = '#5d6367')}
              >
                limpiar filtros
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Expanded detail ──────────────────────────────────────────────────────────

function ExpandedDetail({ result, onDeepAnalysis }: { result: AnalyzedBug; onDeepAnalysis?: (bug: AnalyzedBug) => void }) {
  const { enriched, analysis } = result
  const raw = enriched.raw
  const diff = difficultyStyle[analysis.difficulty] ?? difficultyStyle['medium']
  const sv   = severityStyle[analysis.severity]
  const ct   = categoryStyle[analysis.category]
  const allImages = enriched.googleDocs.flatMap((d) => d.images ?? [])

  const status = analysis.analysisStatus ?? 'deep_completed'  // legacy: análisis viejos sin status se asumen deep
  const isFast    = status === 'fast_completed'
  const isPending = status === 'deep_pending'

  return (
    <div style={{ borderTop: '1px solid rgba(93,99,103,0.20)' }}>
      {/* Header strip */}
      <div className="flex items-start gap-4 px-6 py-3"
        style={{ background: '#141719', borderBottom: '1px solid rgba(93,99,103,0.16)' }}>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm mb-0.5" style={{ color: '#cacccc' }}>{raw.title}</div>
          <div className="text-xs font-mono" style={{ color: '#4b4e55' }}>{analysis.summary}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <OmBadge style={ct}>{analysis.category}</OmBadge>
          {analysis.bugType && (
            <OmBadge style={{ text: '#798186', bg: 'rgba(121,129,134,0.08)', border: 'rgba(121,129,134,0.22)' }}>
              {analysis.bugType}
            </OmBadge>
          )}
          <OmBadge style={sv}>{analysis.severity}</OmBadge>
          <OmBadge style={{ text: diff.text, bg: diff.bg, border: diff.border }}>{diff.label}</OmBadge>
          <div className="ml-1"><ConfidenceBar value={analysis.confidence} /></div>
        </div>
      </div>

      {/* Vista compacta para fast triage: resumen + candidateFiles + botón */}
      {isFast && (
        <FastTriageView result={result} onDeepAnalysis={onDeepAnalysis} />
      )}

      {/* Loader para deep_pending */}
      {isPending && (
        <DeepPendingView />
      )}

      {/* Vista completa para deep_completed y failed */}
      {!isFast && !isPending && (
      <div className="p-5 space-y-3" style={{ background: 'rgba(16,19,21,0.70)' }}>

        {/* 1. DESCRIPCIÓN DEL PROBLEMA — arriba de todo */}
        <ProblemDescriptionSection
          problem={analysis.problemDescription}
          raw={raw}
          googleDocs={enriched.googleDocs}
        />

        {/* 2. CLASIFICACIÓN + por qué no otras categorías */}
        <SectionCard title="por qué esta clasificación">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="label">razón</div>
              <p className="text-xs leading-relaxed" style={{ color: '#9fa5a9' }}>
                {analysis.classificationReason || <span className="italic" style={{ color: '#343d41' }}>sin información</span>}
              </p>
              {analysis.confidenceReason && (
                <>
                  <div className="label" style={{ marginTop: '0.75rem' }}>razón de confianza</div>
                  <p className="text-xs leading-relaxed" style={{ color: '#798186' }}>{analysis.confidenceReason}</p>
                </>
              )}
            </div>
            {analysis.whyNotOtherCategories && analysis.whyNotOtherCategories.length > 0 && (
              <div>
                <div className="label">descartado</div>
                <ul className="space-y-1.5">
                  {analysis.whyNotOtherCategories.map((c, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
                        style={{ color: '#4b4e55', border: '1px solid rgba(75,78,85,0.30)' }}>
                        {c.category}
                      </span>
                      <span className="text-xs leading-relaxed" style={{ color: '#4b4e55' }}>{c.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </SectionCard>

        {/* 3. ÁREA AFECTADA */}
        {analysis.affectedArea && (
          <SectionCard title="área afectada" accent>
            <div className="flex items-start gap-2">
              <code className="text-xs font-mono break-all flex-1" style={{ color: '#798186' }}>
                {analysis.affectedArea}
              </code>
              <CopyButton text={analysis.affectedArea} />
            </div>
          </SectionCard>
        )}

        {/* 4. CAUSA PROBABLE — estructurada si está, fallback al string */}
        <SectionCard title="causa probable">
          {analysis.structuredCause ? (
            <StructuredCauseView cause={analysis.structuredCause} />
          ) : (
            <div className="text-xs leading-relaxed whitespace-pre-wrap font-mono" style={{ color: '#9fa5a9' }}>
              {analysis.probableCause || <span className="italic" style={{ color: '#343d41' }}>sin información</span>}
            </div>
          )}
        </SectionCard>

        {/* 5. IMPACTO FUNCIONAL */}
        {analysis.functionalImpact && (
          <SectionCard title="impacto funcional">
            <p className="text-xs leading-relaxed" style={{ color: '#9fa5a9' }}>{analysis.functionalImpact}</p>
          </SectionCard>
        )}

        {/* 6. EVIDENCIA USADA */}
        {analysis.evidenceUsed && analysis.evidenceUsed.length > 0 && (
          <SectionCard title="evidencia usada">
            <div className="space-y-1.5">
              {analysis.evidenceUsed.map((ev, i) => {
                const es = evidenceStyle[ev.source] ?? evidenceStyle['inference']
                const str = ev.strength ? strengthStyle[ev.strength] : null
                return (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
                      style={{ color: es.text, border: `1px solid ${es.border}`, background: 'transparent' }}>
                      {es.label}
                    </span>
                    <div className="flex-1">
                      <span className="text-xs leading-relaxed" style={{ color: '#798186' }}>{ev.description}</span>
                      {(str || ev.relatedTo) && (
                        <div className="flex items-center gap-2 mt-0.5">
                          {str && (
                            <span className="text-xs font-mono" style={{ color: str.text }}>
                              {str.label}
                            </span>
                          )}
                          {ev.relatedTo && (
                            <span className="text-xs font-mono" style={{ color: '#4b4e55' }}>
                              → {ev.relatedTo.replace('_', ' ')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            {allImages.length > 0 && (
              <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(93,99,103,0.18)' }}>
                <div className="text-xs font-mono mb-2" style={{ color: '#343d41' }}>
                  {allImages.length} captura{allImages.length > 1 ? 's' : ''}
                </div>
                <DocImageGallery images={allImages} />
              </div>
            )}
          </SectionCard>
        )}

        {/* 5. INCONSISTENCIAS DETECTADAS — destacar discrepancias reportado vs encontrado */}
        {analysis.detectedInconsistencies && analysis.detectedInconsistencies.length > 0 && (
          <InconsistenciesSection items={analysis.detectedInconsistencies} />
        )}

        {/* 6. HIPÓTESIS PRINCIPALES ordenadas por probabilidad */}
        {analysis.hypotheses && analysis.hypotheses.length > 0 && (
          <HypothesesSection items={analysis.hypotheses} />
        )}

        {/* 7 + 8. FIX SUGERIDO + INVESTIGACIÓN */}
        <div className="grid grid-cols-2 gap-3">
          {(analysis.suggestedFix || (analysis.suggestedFixSteps && analysis.suggestedFixSteps.length > 0)) && (
            <SectionCard title="fix sugerido">
              {analysis.suggestedFix && analysis.suggestedFix.summary && (
                <p className="text-xs leading-relaxed mb-2" style={{ color: '#9fa5a9' }}>
                  {analysis.suggestedFix.summary}
                </p>
              )}
              <ol className="space-y-2">
                {(analysis.suggestedFix?.steps?.length ? analysis.suggestedFix.steps : analysis.suggestedFixSteps).map((step, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="flex-shrink-0 w-4 h-4 rounded text-xs flex items-center justify-center font-mono mt-0.5"
                      style={{ color: '#798186', border: '1px solid rgba(121,129,134,0.30)', background: 'transparent' }}>
                      {i + 1}
                    </span>
                    <span className="text-xs leading-relaxed" style={{ color: '#9fa5a9' }}>{step}</span>
                  </li>
                ))}
              </ol>
              {analysis.suggestedFix?.dependsOn && (
                <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(93,99,103,0.18)' }}>
                  <div className="label">depende de</div>
                  <p className="text-xs leading-relaxed" style={{ color: '#c9a07a' }}>{analysis.suggestedFix.dependsOn}</p>
                </div>
              )}
            </SectionCard>
          )}

          {analysis.investigationSteps && analysis.investigationSteps.length > 0 && (
            <SectionCard title="investigación">
              <ol className="space-y-2">
                {analysis.investigationSteps.map((step, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="flex-shrink-0 w-4 h-4 rounded text-xs flex items-center justify-center font-mono mt-0.5"
                      style={{ color: '#4b4e55', border: '1px solid rgba(75,78,85,0.30)', background: 'transparent' }}>
                      {i + 1}
                    </span>
                    <span className="text-xs leading-relaxed" style={{ color: '#798186' }}>
                      {step.replace(/^Paso \d+:\s*/i, '')}
                    </span>
                  </li>
                ))}
              </ol>
            </SectionCard>
          )}
        </div>

        {/* 9. ARCHIVOS RELACIONADOS con whatToCheck */}
        {analysis.relatedFilesWithReasons && analysis.relatedFilesWithReasons.length > 0 && (
          <SectionCard title="archivos relacionados">
            <div className="space-y-2">
              {analysis.relatedFilesWithReasons.map((f, i) => (
                <div key={i} className="rounded p-2.5"
                  style={{ background: 'rgba(13,16,19,0.70)', border: '1px solid rgba(93,99,103,0.18)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    {f.relationType && (
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{ color: relationStyle[f.relationType] ?? '#798186', border: `1px solid ${relationStyle[f.relationType] ?? '#798186'}33` }}>
                        {f.relationType}
                      </span>
                    )}
                    <code className="text-xs font-mono flex-1 break-all" style={{ color: '#798186' }}>{f.path}</code>
                    {typeof f.confidence === 'number' && (
                      <span className="text-xs font-mono flex-shrink-0" style={{ color: '#4b4e55' }}>
                        {Math.round(f.confidence * 100)}%
                      </span>
                    )}
                    <CopyButton text={f.path} />
                  </div>
                  {f.reason && (
                    <p className="text-xs leading-relaxed" style={{ color: '#4b4e55' }}>{f.reason}</p>
                  )}
                  {f.whatToCheck && f.whatToCheck.length > 0 && (
                    <div className="mt-1.5 pt-1.5" style={{ borderTop: '1px solid rgba(93,99,103,0.15)' }}>
                      <div className="label">qué revisar</div>
                      <ul className="space-y-0.5">
                        {f.whatToCheck.map((c, j) => (
                          <li key={j} className="flex items-start gap-1.5">
                            <span className="text-xs flex-shrink-0" style={{ color: '#343d41' }}>›</span>
                            <span className="text-xs leading-relaxed" style={{ color: '#798186' }}>{c}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {f.relevantSnippets && f.relevantSnippets.length > 0 && (
                    <div className="mt-2 pt-2 space-y-2" style={{ borderTop: '1px solid rgba(93,99,103,0.15)' }}>
                      <div className="label">snippets relevantes</div>
                      {f.relevantSnippets.map((s, j) => (
                        <SnippetView key={j} snippet={s} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* 10 + 11. INFORMACIÓN FALTANTE + NO SE PUEDE AFIRMAR */}
        <div className="grid grid-cols-2 gap-3">
          {analysis.missingInformation && analysis.missingInformation.length > 0 && (
            <SectionCard title="información faltante">
              <ul className="space-y-1">
                {analysis.missingInformation.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-xs font-mono flex-shrink-0 mt-0.5" style={{ color: '#de6145' }}>?</span>
                    <span className="text-xs leading-relaxed" style={{ color: '#4b4e55' }}>{item}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
          {analysis.cannotConclude && analysis.cannotConclude.length > 0 && (
            <SectionCard title="no se puede afirmar">
              <ul className="space-y-1">
                {analysis.cannotConclude.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-xs font-mono flex-shrink-0 mt-0.5" style={{ color: '#c9a07a' }}>✗</span>
                    <span className="text-xs leading-relaxed" style={{ color: '#4b4e55' }}>{item}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </div>

        {/* 13. RECOMENDACIÓN FINAL — conclusión accionable */}
        {analysis.finalRecommendation && (
          <SectionCard title="recomendación final" accent>
            <p className="text-xs leading-relaxed" style={{ color: '#c9c2b4' }}>
              {analysis.finalRecommendation}
            </p>
          </SectionCard>
        )}

        {/* VALIDACIÓN MANUAL — banner si aplica */}
        {analysis.manualValidationNeeded && (
          <div className="rounded p-2.5 flex items-center gap-2"
            style={{ background: 'rgba(180,130,100,0.06)', border: '1px solid rgba(180,130,100,0.22)' }}>
            <span className="text-xs font-mono" style={{ color: '#c9a07a' }}>⚠</span>
            <span className="text-xs font-mono" style={{ color: '#c9a07a' }}>
              requiere validación manual — reproducí el caso antes de aplicar el fix
            </span>
          </div>
        )}

        {/* Reporte original colapsable (debug) */}
        <details className="group">
          <summary className="text-xs font-mono cursor-pointer select-none transition-colors flex items-center gap-1.5"
            style={{ color: '#4b4e55', listStyle: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#798186')}
            onMouseLeave={e => (e.currentTarget.style.color = '#4b4e55')}>
            <svg width="7" height="7" viewBox="0 0 8 8" fill="currentColor" className="group-open:rotate-90 transition-transform">
              <path d="M2 1l4 3-4 3V1z"/>
            </svg>
            datos originales del reporte
          </summary>
          <div className="mt-2 rounded p-3 space-y-2"
            style={{ border: '1px solid rgba(93,99,103,0.18)', background: 'transparent' }}>
            {raw.description && <Field label="descripción" value={raw.description} />}
            {raw.stepsToReproduce && <Field label="pasos para reproducir" value={raw.stepsToReproduce} />}
            {raw.expectedResult && <Field label="resultado esperado" value={raw.expectedResult} />}
            {raw.actualResult && <Field label="resultado actual" value={raw.actualResult} />}
            {raw.environment && <Field label="entorno" value={raw.environment} />}
            {enriched.googleDocs.length > 0 && (
              <div>
                <div className="label">documentos</div>
                {enriched.googleDocs.map((doc, i) => (
                  <div key={i} className="text-xs font-mono">
                    {doc.accessible
                      ? <span style={{ color: '#9fa5a9' }}>✓ {doc.title}</span>
                      : <span style={{ color: '#de6145' }}>✗ {doc.url} — {doc.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>

        {result.error && (
          <div className="rounded p-3" style={{ background: 'rgba(222,97,69,0.08)', border: '1px solid rgba(222,97,69,0.22)' }}>
            <div className="text-xs font-mono mb-1" style={{ color: '#de6145' }}>error durante el análisis</div>
            <div className="text-xs font-mono" style={{ color: '#c9a07a' }}>{result.error}</div>
          </div>
        )}
      </div>
      )}

      {/* Fragmentos de código al pie */}
      {!isFast && !isPending && enriched.codeFragments.length > 0 && (
        <div className="px-5 py-4" style={{ borderTop: '1px solid rgba(93,99,103,0.18)' }}>
          <div className="section-label mb-3">
            código fuente
            <span className="ml-2 normal-case" style={{ color: '#343d41', letterSpacing: '0' }}>
              ({enriched.codeFragments.length} fragmento{enriched.codeFragments.length > 1 ? 's' : ''})
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {enriched.codeFragments.map((frag, i) => (
              <CodeBlock key={i} {...frag} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Fast triage view ─────────────────────────────────────────────────────────
// Vista compacta del fast triage: clasificación corta + archivos candidatos
// + botón para promover a deep analysis. El usuario decide qué bugs profundizar.

function FastTriageView({ result, onDeepAnalysis }: { result: AnalyzedBug; onDeepAnalysis?: (bug: AnalyzedBug) => void }) {
  const { enriched, analysis } = result
  const raw = enriched.raw
  const candidates = analysis.candidateFiles ?? analysis.relatedFiles ?? []

  return (
    <div className="p-5 space-y-3" style={{ background: 'rgba(16,19,21,0.70)' }}>
      <SectionCard title="triage rápido" accent>
        <div className="space-y-2">
          <div>
            <div className="label">resumen</div>
            <p className="text-xs leading-relaxed" style={{ color: '#9fa5a9' }}>{analysis.summary}</p>
          </div>
          {analysis.affectedArea && (
            <div>
              <div className="label">área</div>
              <code className="text-xs font-mono break-all" style={{ color: '#798186' }}>{analysis.affectedArea}</code>
            </div>
          )}
          {analysis.oneLineReason && (
            <div>
              <div className="label">por qué esta categoría</div>
              <p className="text-xs leading-relaxed" style={{ color: '#798186' }}>{analysis.oneLineReason}</p>
            </div>
          )}
        </div>
      </SectionCard>

      {candidates.length > 0 && (
        <SectionCard title={`archivos candidatos (${candidates.length}) — búsqueda local`}>
          <ul className="space-y-1">
            {candidates.map((path, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="text-xs flex-shrink-0" style={{ color: '#343d41' }}>›</span>
                <code className="text-xs font-mono flex-1 break-all" style={{ color: '#798186' }}>{path}</code>
                <CopyButton text={path} />
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* Resumen de fuentes disponibles */}
      <div className="flex items-center gap-2 text-xs font-mono" style={{ color: '#4b4e55' }}>
        <span>fuentes:</span>
        <span style={{ color: '#798186' }}>excel</span>
        {enriched.googleDocs.filter((d) => d.accessible).length > 0 && (
          <>
            <span>·</span>
            <span style={{ color: '#c9c2b4' }}>
              {enriched.googleDocs.filter((d) => d.accessible).length} doc(s)
            </span>
          </>
        )}
        {enriched.googleDocs.some((d) => (d.images?.length ?? 0) > 0) && (
          <>
            <span>·</span>
            <span style={{ color: '#aeaeae' }}>
              {enriched.googleDocs.reduce((a, d) => a + (d.images?.length ?? 0), 0)} captura(s) no procesadas
            </span>
          </>
        )}
      </div>

      {/* CTA principal: generar análisis profundo */}
      {onDeepAnalysis && (
        <button
          onClick={() => onDeepAnalysis(result)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded transition-colors cursor-pointer"
          style={{
            background: 'rgba(201,194,180,0.08)',
            border: '1px solid rgba(201,194,180,0.30)',
            color: '#c9c2b4',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(201,194,180,0.14)'
            e.currentTarget.style.borderColor = 'rgba(201,194,180,0.50)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(201,194,180,0.08)'
            e.currentTarget.style.borderColor = 'rgba(201,194,180,0.30)'
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <span className="text-xs font-mono">generar análisis profundo</span>
        </button>
      )}

      {/* Datos originales en colapsable */}
      <details className="group">
        <summary className="text-xs font-mono cursor-pointer select-none transition-colors flex items-center gap-1.5"
          style={{ color: '#4b4e55', listStyle: 'none' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#798186')}
          onMouseLeave={e => (e.currentTarget.style.color = '#4b4e55')}>
          <svg width="7" height="7" viewBox="0 0 8 8" fill="currentColor" className="group-open:rotate-90 transition-transform">
            <path d="M2 1l4 3-4 3V1z"/>
          </svg>
          datos originales del reporte
        </summary>
        <div className="mt-2 rounded p-3 space-y-2"
          style={{ border: '1px solid rgba(93,99,103,0.18)', background: 'transparent' }}>
          {raw.description && <Field label="descripción" value={raw.description} />}
          {Object.entries(raw.rawRow).filter(([, v]) => v?.trim()).map(([k, v]) => (
            <Field key={k} label={k.toLowerCase()} value={v} />
          ))}
        </div>
      </details>
    </div>
  )
}

// ─── Deep analysis pending view ───────────────────────────────────────────────

function DeepPendingView() {
  return (
    <div className="p-8" style={{ background: 'rgba(16,19,21,0.70)' }}>
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#c9c2b4' }} />
          <span className="text-xs font-mono" style={{ color: '#c9c2b4' }}>análisis profundo en proceso</span>
        </div>
        <p className="text-xs font-mono text-center max-w-md leading-relaxed" style={{ color: '#4b4e55' }}>
          el agente está navegando el código fuente, leyendo archivos relevantes,
          y construyendo el análisis estructurado. tarda ~2-4 minutos por bug.
        </p>
        <p className="text-xs font-mono" style={{ color: '#343d41' }}>
          podés seguir trabajando — esto corre en background
        </p>
      </div>
    </div>
  )
}

// ─── Problem description section ──────────────────────────────────────────────
// Renders the "qué se reportó" block at the top of the detail.
// Falls back to raw excel fields when the LLM didn't produce a structured problemDescription.

function ProblemDescriptionSection({
  problem,
  raw,
  googleDocs,
}: {
  problem?: import('../../src/types/index').ProblemDescription
  raw: import('../../src/types/index').RawBug
  googleDocs: import('../../src/types/index').GoogleDocContent[]
}) {
  // Effective values: prefer structured problemDescription, fallback to raw excel fields
  const original   = problem?.originalReport   || raw.description       || 'No informado'
  const docSummary = problem?.documentSummary  || ''
  const observed   = problem?.observedBehavior || raw.actualResult      || 'No informado'
  const expected   = problem?.expectedBehavior || raw.expectedResult    || 'No informado'
  const steps      = problem?.reproductionSteps && problem.reproductionSteps.length > 0
    ? problem.reproductionSteps
    : raw.stepsToReproduce ? raw.stepsToReproduce.split('\n').filter(Boolean) : []
  const route      = problem?.affectedRoute || ''
  const env        = problem?.environment   || raw.environment || ''
  const sources    = problem?.sources       || []
  const hasDocs    = googleDocs.some((d) => d.accessible)
  const hasImgs    = googleDocs.some((d) => (d.images?.length ?? 0) > 0)

  // Derive sources badges if not provided
  const inferredSources = sources.length > 0 ? sources : [
    'excel',
    ...(hasDocs ? ['document'] : []),
    ...(hasImgs ? ['screenshot'] : []),
  ]

  return (
    <SectionCard title="descripción del problema" accent>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3">
        <div className="col-span-2">
          <div className="label">reporte original</div>
          <p className="text-xs leading-relaxed" style={{ color: '#9fa5a9' }}>{original}</p>
        </div>

        {docSummary && (
          <div className="col-span-2">
            <div className="label">resumen del documento</div>
            <p className="text-xs leading-relaxed" style={{ color: '#9fa5a9' }}>{docSummary}</p>
          </div>
        )}

        <div>
          <div className="label">resultado actual</div>
          <p className="text-xs leading-relaxed" style={{ color: observed === 'No informado' ? '#4b4e55' : '#9fa5a9' }}>
            {observed}
          </p>
        </div>

        <div>
          <div className="label">resultado esperado</div>
          <p className="text-xs leading-relaxed" style={{ color: expected === 'No informado' ? '#4b4e55' : '#9fa5a9' }}>
            {expected}
          </p>
        </div>

        {steps.length > 0 && (
          <div className="col-span-2">
            <div className="label">pasos para reproducir</div>
            <ol className="space-y-1">
              {steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-xs font-mono flex-shrink-0 mt-0.5" style={{ color: '#4b4e55' }}>{i + 1}.</span>
                  <span className="text-xs leading-relaxed" style={{ color: '#9fa5a9' }}>
                    {s.replace(/^\d+[.)]\s*/, '')}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {route && (
          <div>
            <div className="label">ruta / pantalla</div>
            <code className="text-xs font-mono break-all" style={{ color: '#798186' }}>{route}</code>
          </div>
        )}

        {env && (
          <div>
            <div className="label">ambiente</div>
            <code className="text-xs font-mono" style={{ color: '#798186' }}>{env}</code>
          </div>
        )}

        {inferredSources.length > 0 && (
          <div className="col-span-2">
            <div className="label">fuentes</div>
            <div className="flex flex-wrap gap-1.5">
              {inferredSources.map((s, i) => {
                const es = evidenceStyle[s as EvidenceSource] ?? evidenceStyle['inference']
                return (
                  <span key={i} className="text-xs font-mono px-1.5 py-0.5 rounded"
                    style={{ color: es.text, border: `1px solid ${es.border}` }}>
                    {es.label}
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

// ─── Structured cause view ────────────────────────────────────────────────────
// Renders the observation / hypothesis / evidence / risk split.

function StructuredCauseView({ cause }: { cause: NonNullable<import('../../src/types/index').BugAnalysis['structuredCause']> }) {
  return (
    <div className="space-y-2.5">
      {cause.observation && (
        <div>
          <div className="label">observación confirmada</div>
          <p className="text-xs leading-relaxed" style={{ color: '#9fa5a9' }}>{cause.observation}</p>
        </div>
      )}
      {cause.hypothesis && (
        <div>
          <div className="label">hipótesis técnica</div>
          <p className="text-xs leading-relaxed" style={{ color: '#9fa5a9' }}>{cause.hypothesis}</p>
        </div>
      )}
      {cause.evidence && cause.evidence.length > 0 && (
        <div>
          <div className="label">evidencia que sostiene</div>
          <ul className="space-y-0.5">
            {cause.evidence.map((e, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-xs flex-shrink-0" style={{ color: '#343d41' }}>›</span>
                <span className="text-xs leading-relaxed" style={{ color: '#798186' }}>{e}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cause.risk && (
        <div>
          <div className="label">riesgo / a validar</div>
          <p className="text-xs leading-relaxed" style={{ color: '#c9a07a' }}>{cause.risk}</p>
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
      <div className="flex flex-wrap gap-1.5">
        {images.map((img, i) => (
          <button
            key={i}
            onClick={() => setLightbox(img)}
            className="group relative rounded overflow-hidden transition-colors"
            style={{ border: '1px solid rgba(93,99,103,0.25)', background: '#141719' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(121,129,134,0.50)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(93,99,103,0.25)')}
          >
            <img
              src={`data:${img.mimeType};base64,${img.data}`}
              alt={img.alt || `Imagen ${i + 1}`}
              className="h-16 w-auto max-w-[120px] object-contain"
            />
          </button>
        ))}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(16,19,21,0.92)' }}
          onClick={() => setLightbox(null)}>
          <div className="relative max-w-5xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={`data:${lightbox.mimeType};base64,${lightbox.data}`}
              alt={lightbox.alt || 'Imagen del documento'}
              className="max-w-full max-h-[85vh] object-contain rounded"
              style={{ border: '1px solid rgba(93,99,103,0.30)' }}
            />
            {lightbox.alt && (
              <div className="mt-2 text-center text-xs font-mono" style={{ color: '#4b4e55' }}>{lightbox.alt}</div>
            )}
            <button
              onClick={() => setLightbox(null)}
              className="absolute -top-3 -right-3 w-7 h-7 rounded-full flex items-center justify-center transition-colors cursor-pointer"
              style={{ background: '#1c2124', border: '1px solid rgba(93,99,103,0.45)', color: '#798186' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#cacccc'; e.currentTarget.style.borderColor = 'rgba(121,129,134,0.60)' }}
              onMouseLeave={e => { e.currentTarget.style.color = '#798186'; e.currentTarget.style.borderColor = 'rgba(93,99,103,0.45)' }}
              aria-label="cerrar"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Inconsistencies section ──────────────────────────────────────────────────
// Destaca discrepancias entre lo reportado y lo encontrado — un dev necesita
// verlas primero porque cambian la dirección del fix.

const inconsistencyTypeLabel: Record<string, string> = {
  route_mismatch:    'ruta no coincide',
  module_mismatch:   'módulo no coincide',
  category_conflict: 'conflicto de categoría',
  missing_evidence:  'evidencia faltante',
  naming_mismatch:   'nombre no coincide',
  other:             'otro',
}

function InconsistenciesSection({ items }: { items: NonNullable<import('../../src/types/index').BugAnalysis['detectedInconsistencies']> }) {
  return (
    <SectionCard title={`inconsistencias detectadas (${items.length})`}>
      <div className="space-y-2.5">
        {items.map((inc, i) => (
          <div key={i} className="rounded p-2.5"
            style={{ background: 'rgba(180,130,100,0.04)', border: '1px solid rgba(180,130,100,0.20)' }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                style={{ color: '#c9a07a', border: '1px solid rgba(180,130,100,0.35)' }}>
                {inconsistencyTypeLabel[inc.type] ?? inc.type}
              </span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: '#9fa5a9' }}>{inc.description}</p>
            {inc.impact && (
              <div className="mt-1.5">
                <div className="label">impacto</div>
                <p className="text-xs leading-relaxed" style={{ color: '#798186' }}>{inc.impact}</p>
              </div>
            )}
            {inc.evidence && inc.evidence.length > 0 && (
              <div className="mt-1.5">
                <div className="label">evidencia</div>
                <ul className="space-y-0.5">
                  {inc.evidence.map((e, j) => (
                    <li key={j} className="flex items-start gap-1.5">
                      <span className="text-xs flex-shrink-0" style={{ color: '#343d41' }}>›</span>
                      <span className="text-xs leading-relaxed" style={{ color: '#798186' }}>{e}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

// ─── Hypotheses section ───────────────────────────────────────────────────────
// 2-3 hipótesis ordenadas por probabilidad — evita tunnel vision.

const probabilityStyle: Record<string, { label: string; text: string; bg: string; border: string }> = {
  high:   { label: 'alta',  text: '#de6145', bg: 'rgba(222,97,69,0.06)',  border: 'rgba(222,97,69,0.25)' },
  medium: { label: 'media', text: '#c9a07a', bg: 'rgba(180,130,100,0.06)', border: 'rgba(180,130,100,0.25)' },
  low:    { label: 'baja',  text: '#798186', bg: 'rgba(121,129,134,0.06)', border: 'rgba(121,129,134,0.22)' },
}

function HypothesesSection({ items }: { items: NonNullable<import('../../src/types/index').BugAnalysis['hypotheses']> }) {
  return (
    <SectionCard title={`hipótesis (${items.length})`}>
      <div className="space-y-2.5">
        {items.map((h, i) => {
          const p = probabilityStyle[h.probability] ?? probabilityStyle['medium']
          return (
            <div key={i} className="rounded p-2.5"
              style={{ background: p.bg, border: `1px solid ${p.border}` }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-mono" style={{ color: '#4b4e55' }}>#{i + 1}</span>
                <span className="text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                  style={{ color: p.text, border: `1px solid ${p.border}` }}>
                  {p.label}
                </span>
                <span className="text-xs leading-relaxed font-medium flex-1" style={{ color: '#cacccc' }}>
                  {h.title}
                </span>
              </div>
              {h.evidence && h.evidence.length > 0 && (
                <div className="mt-1.5">
                  <div className="label">evidencia</div>
                  <ul className="space-y-0.5">
                    {h.evidence.map((e, j) => (
                      <li key={j} className="flex items-start gap-1.5">
                        <span className="text-xs flex-shrink-0" style={{ color: '#343d41' }}>›</span>
                        <span className="text-xs leading-relaxed" style={{ color: '#798186' }}>{e}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {h.howToValidate && h.howToValidate.length > 0 && (
                <div className="mt-1.5">
                  <div className="label">cómo validarla</div>
                  <ol className="space-y-0.5">
                    {h.howToValidate.map((v, j) => (
                      <li key={j} className="flex items-start gap-1.5">
                        <span className="text-xs font-mono flex-shrink-0" style={{ color: '#4b4e55' }}>{j + 1}.</span>
                        <span className="text-xs leading-relaxed" style={{ color: '#9fa5a9' }}>{v}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

// ─── Snippet view ─────────────────────────────────────────────────────────────
// Renders un fragmento concreto de código bajo el archivo relacionado.
// Mantiene la estética de CodeBlock pero compacto.

function SnippetView({ snippet }: { snippet: NonNullable<import('../../src/types/index').RelevantSnippet> }) {
  const lines = snippet.code.split('\n')
  return (
    <div className="rounded overflow-hidden" style={{ border: '1px solid rgba(93,99,103,0.18)' }}>
      <div className="flex items-center justify-between px-2 py-1"
        style={{ background: '#0d1013', borderBottom: '1px solid rgba(93,99,103,0.18)' }}>
        <span className="text-xs font-mono" style={{ color: '#4b4e55' }}>
          líneas {snippet.startLine}–{snippet.endLine}
        </span>
        <CopyButton text={snippet.code} />
      </div>
      <pre className="text-xs p-2 overflow-x-auto leading-relaxed" style={{ color: '#9fa5a9', background: '#0d1013' }}>
        {lines.map((line, i) => (
          <div key={i} className="flex gap-2">
            <span className="select-none w-6 text-right flex-shrink-0" style={{ color: '#343d41' }}>{snippet.startLine + i}</span>
            <span>{line}</span>
          </div>
        ))}
      </pre>
      {snippet.whyRelevant && (
        <div className="px-2 py-1.5" style={{ borderTop: '1px solid rgba(93,99,103,0.18)' }}>
          <span className="text-xs leading-relaxed" style={{ color: '#798186' }}>{snippet.whyRelevant}</span>
        </div>
      )}
    </div>
  )
}
