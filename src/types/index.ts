// ─── Bug raw (del Excel) ──────────────────────────────────────────────────────

export interface RawBug {
  id: string
  rowIndex: number
  title: string
  description: string
  stepsToReproduce?: string
  expectedResult?: string
  actualResult?: string
  environment?: string
  reporter?: string
  assignee?: string
  status?: string
  priority?: string
  /** Todas las celdas de la fila, por si la hoja tiene columnas no estándar */
  rawRow: Record<string, string>
  /** Links a Google Docs/Drive encontrados en cualquier celda */
  googleDocLinks: string[]
}

// ─── Documento de Google Docs ─────────────────────────────────────────────────

export interface DocImage {
  data: string      // base64
  mimeType: string  // 'image/png', 'image/jpeg', etc.
  alt?: string
}

export interface GoogleDocContent {
  url: string
  title: string
  text: string
  accessible: boolean
  error?: string
  images?: DocImage[]
}

// ─── Fragmento de código del repo ─────────────────────────────────────────────

export interface CodeFragment {
  filePath: string
  startLine: number
  endLine: number
  content: string
  score: number
}

// ─── Bug enriquecido (contexto completo para el LLM) ──────────────────────────

export interface EnrichedBug {
  raw: RawBug
  googleDocs: GoogleDocContent[]
  codeFragments: CodeFragment[]
}

// ─── Análisis del LLM ─────────────────────────────────────────────────────────

export type BugCategory =
  | 'frontend'
  | 'backend'
  | 'database'
  | 'config'
  | 'data'
  | 'insufficient_info'

export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type Difficulty = 'low' | 'medium' | 'high'
export type EvidenceSource = 'excel' | 'document' | 'screenshot' | 'code' | 'inference' | 'missing' | 'not_confirmed'
export type EvidenceStrength = 'strong' | 'medium' | 'weak'
export type EvidenceRelation = 'classification' | 'probable_cause' | 'fix' | 'missing_info'

export interface EvidenceItem {
  source: EvidenceSource
  description: string
  strength?: EvidenceStrength               // qué tan fuerte sostiene la afirmación
  relatedTo?: EvidenceRelation              // a qué parte del análisis aplica
}

// Snippet concreto leído del repo durante el agent loop.
// Lo guardamos atado al archivo para mostrarlo bajo el path correspondiente.
export interface RelevantSnippet {
  startLine: number
  endLine: number
  code: string                              // contenido literal de las líneas
  whyRelevant: string                       // por qué el agente lo considera relevante
}

export interface RelatedFileWithReason {
  path: string
  reason: string
  relationType?: string                     // route | configuration | component | template | service | style | model | inference
  confidence?: number                       // 0–1
  whatToCheck?: string[]                    // qué mirar dentro de ese archivo
  relevantSnippets?: RelevantSnippet[]      // fragmentos concretos extraídos del archivo
}

// Inconsistencia entre lo reportado y lo encontrado en el código.
// Crítico para detectar discrepancias que un dev necesita ver primero.
export interface DetectedInconsistency {
  type: 'route_mismatch' | 'module_mismatch' | 'category_conflict' | 'missing_evidence' | 'naming_mismatch' | 'other'
  description: string                       // qué inconsistencia es
  impact: string                            // qué implica para el diagnóstico
  evidence: string[]                        // citas que la sostienen
}

// Hipótesis alternativa con probabilidad y forma de validarla.
// El deep analysis debe ofrecer 2-3 — no una sola — para evitar tunnel vision.
export interface Hypothesis {
  title: string                             // resumen corto de la hipótesis
  probability: 'high' | 'medium' | 'low'
  evidence: string[]                        // qué la sostiene
  howToValidate: string[]                   // pasos concretos para confirmarla o descartarla
}

// Fix sugerido condicionado a la hipótesis principal.
// dependsOn aclara qué confirmar antes de aplicarlo.
export interface SuggestedFix {
  summary: string                           // qué hacer si se confirma la hipótesis principal
  steps: string[]                           // pasos concretos del fix
  dependsOn: string                         // qué confirmar antes de tocar nada
}

export interface CategoryDiscarded {
  category: string                          // backend, database, etc.
  reason: string                            // por qué no se eligió esta categoría
}

// Descripción del problema — separa "qué se reportó" de "qué creemos que pasa".
// Todas las claves son strings (o arrays); si una pieza falta, debe venir como
// "No informado" en vez de null/undefined para que la UI pueda mostrarlo.
export interface ProblemDescription {
  originalReport: string                    // descripción del Excel
  documentSummary: string                   // resumen de lo que dice el Google Doc
  observedBehavior: string                  // resultado actual
  expectedBehavior: string                  // resultado esperado
  reproductionSteps: string[]               // pasos para reproducir
  affectedRoute: string                     // ruta / URL afectada
  environment: string                       // ambiente (dev, prod, local…)
  sources: string[]                         // ["excel", "document", "screenshot", "inference"]
}

// Causa probable estructurada — separa observación de hipótesis.
export interface StructuredCause {
  observation: string                       // qué se observó realmente (confirmado)
  hypothesis: string                        // mecanismo técnico propuesto
  evidence: string[]                        // qué sostiene la hipótesis
  risk: string                              // qué podría estar mal o falta validar
}

// Estado del análisis para distinguir fast triage de deep analysis.
// El batch siempre arranca con 'fast_completed' y se promueve a 'deep_completed'
// cuando el usuario pide análisis profundo del bug específico.
export type AnalysisStatus = 'fast_completed' | 'deep_pending' | 'deep_completed' | 'failed'

// Salida del fast triage — campos mínimos para llenar la tabla principal.
// Subset de BugAnalysis: el deep analysis lo extiende sin perder estos campos.
export interface BugTriage {
  category: BugCategory
  severity: Severity
  difficulty: Difficulty
  confidence: number                        // 0–1
  bugType?: string

  summary: string                           // 1 oración, qué está roto
  affectedArea: string                      // componente / función / módulo
  oneLineReason: string                     // por qué esta categoría, una sola oración
  candidateFiles: string[]                  // top N archivos candidatos (búsqueda local sin LLM)

  needsMoreInfo: boolean
  rawResponse: string
}

export interface BugAnalysis {
  category: BugCategory
  severity: Severity
  difficulty: Difficulty
  confidence: number                        // 0–1
  bugType?: string                          // ui | validation | routing | permissions | api | …

  analysisStatus: AnalysisStatus            // fast_completed | deep_pending | deep_completed | failed

  summary: string                           // 1 oración, qué está roto
  affectedArea: string                      // componente / función / módulo específico
  oneLineReason?: string                    // razón corta usada en fast triage
  candidateFiles?: string[]                 // candidatos del fast triage (sin LLM)

  problemDescription?: ProblemDescription   // qué se reportó (≠ qué creemos que pasa)
  functionalImpact?: string                 // a qué afecta funcionalmente

  classificationReason: string              // por qué esta categoría
  confidenceReason: string                  // por qué esta confianza
  whyNotOtherCategories?: CategoryDiscarded[] // por qué se descartaron las otras

  probableCause: string                     // string legacy — derivado de structuredCause si está
  structuredCause?: StructuredCause         // versión estructurada (preferida)

  suggestedFixSteps: string[]               // pasos concretos del fix (legacy / flat)
  investigationSteps: string[]              // pasos ordenados para llegar al bug
  evidenceUsed: EvidenceItem[]              // fuentes usadas con badge

  cannotConclude: string[]                  // qué NO se puede afirmar
  missingInformation?: string[]             // qué información falta

  relatedFilesWithReasons: RelatedFileWithReason[]  // archivos + motivo + qué revisar + snippets
  relatedFiles: string[]                    // derivado de relatedFilesWithReasons (compat)

  // ─── Campos exclusivos del deep analysis ────────────────────────────────────
  // Se llenan solo cuando analysisStatus === 'deep_completed'. La UI los muestra
  // solo si vienen presentes — el fast triage NO los produce.
  detectedInconsistencies?: DetectedInconsistency[]  // discrepancias reportado vs encontrado
  hypotheses?: Hypothesis[]                          // 2-3 hipótesis ordenadas por probabilidad
  suggestedFix?: SuggestedFix                        // fix estructurado con dependsOn
  finalRecommendation?: string                       // conclusión corta y accionable

  manualValidationNeeded?: boolean          // requiere reproducción manual
  needsMoreInfo: boolean
  rawResponse: string
}

// ─── Bug analizado (resultado final) ──────────────────────────────────────────

export interface AnalyzedBug {
  enriched: EnrichedBug
  analysis: BugAnalysis
  error?: string
  processingMs: number
}

// ─── Config de LLM ────────────────────────────────────────────────────────────

export type LLMProvider = 'ollama' | 'anthropic' | 'gemini' | 'openai'

export interface LLMConfig {
  provider: LLMProvider
  model?: string
  baseUrl?: string
  apiKey?: string
  temperature?: number
  maxTokens?: number
}

// ─── Config de repos ──────────────────────────────────────────────────────────

export interface RepoConfig {
  frontendPath: string
  backendPath: string
  indexPath: string
}

// ─── Config general de la app ─────────────────────────────────────────────────

export interface AppConfig {
  llm: LLMConfig
  repos: RepoConfig
  googleAuth: {
    clientId: string
    clientSecret: string
    tokenPath: string
  }
}

// ─── IPC messages ─────────────────────────────────────────────────────────────

export type AnalysisPhase = 'reading_excel' | 'reading_docs' | 'fast_triage' | 'done' | 'error'

export interface ProgressEvent {
  type: 'progress'
  message: string
  current: number
  total: number
  phase?: AnalysisPhase
}

export interface LogEvent {
  type: 'log'
  level: 'info' | 'warn' | 'error'
  message: string
  timestamp: string
}

export interface AnalysisCompleteEvent {
  type: 'complete'
  results: AnalyzedBug[]
}

export interface BugResultEvent {
  type: 'bug-result'
  result: AnalyzedBug
  current: number
  total: number
}

export interface IndexProgressEvent {
  type: 'index-progress'
  message: string
  filesProcessed: number
  totalFiles: number
}

export type IPCEvent =
  | ProgressEvent
  | LogEvent
  | AnalysisCompleteEvent
  | BugResultEvent
  | IndexProgressEvent
