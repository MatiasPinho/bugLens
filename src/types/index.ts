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

export interface BugAnalysis {
  category: BugCategory
  severity: Severity
  difficulty: Difficulty
  confidence: number           // 0–1
  summary: string              // 1 oración, qué está roto
  affectedArea: string         // componente / función / módulo específico
  probableCause: string        // explicación técnica detallada
  suggestedFix: string         // qué cambiar y cómo
  investigationSteps: string[] // pasos ordenados para el dev
  relatedFiles: string[]       // paths reales del repo
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
