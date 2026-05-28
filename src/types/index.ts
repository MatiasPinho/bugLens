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

export interface RelatedFileWithReason {
  path: string
  reason: string
  relationType?: string                     // route | configuration | component | template | service | style | model | inference
  confidence?: number                       // 0–1
  whatToCheck?: string[]                    // qué mirar dentro de ese archivo
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

export interface BugAnalysis {
  category: BugCategory
  severity: Severity
  difficulty: Difficulty
  confidence: number                        // 0–1
  bugType?: string                          // ui | validation | routing | permissions | api | …

  summary: string                           // 1 oración, qué está roto
  affectedArea: string                      // componente / función / módulo específico

  problemDescription?: ProblemDescription   // qué se reportó (≠ qué creemos que pasa)
  functionalImpact?: string                 // a qué afecta funcionalmente

  classificationReason: string              // por qué esta categoría
  confidenceReason: string                  // por qué esta confianza
  whyNotOtherCategories?: CategoryDiscarded[] // por qué se descartaron las otras

  probableCause: string                     // string legacy — derivado de structuredCause si está
  structuredCause?: StructuredCause         // versión estructurada (preferida)

  suggestedFixSteps: string[]               // pasos concretos del fix
  investigationSteps: string[]              // pasos ordenados para llegar al bug
  evidenceUsed: EvidenceItem[]              // fuentes usadas con badge

  cannotConclude: string[]                  // qué NO se puede afirmar
  missingInformation?: string[]             // qué información falta

  relatedFilesWithReasons: RelatedFileWithReason[]  // archivos + motivo + qué revisar
  relatedFiles: string[]                    // derivado de relatedFilesWithReasons (compat)

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

export interface ProgressEvent {
  type: 'progress'
  message: string
  current: number
  total: number
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
