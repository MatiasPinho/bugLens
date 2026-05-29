import { LLMConfig, LLMProvider, BugAnalysis } from '../types/index.js'
import { SYSTEM_PROMPT_DEEP_PART_A, SYSTEM_PROMPT_DEEP_PART_B, buildUserPrompt } from '../prompts/bugClassifier.js'
import { makeCacheKey, loadCachedAnalysis, saveCachedAnalysis } from './analysisCache.js'

// callLLM acepta un systemPrompt opcional — el deep analysis hace 2 calls con
// prompts distintos (PART_A descriptivo, PART_B analítico) para evitar que
// qwen2.5:7b se ahogue con un schema de 20+ campos en una sola pasada.
// Default sigue siendo PART_A para no romper otros callers.
const DEFAULT_SYSTEM_PROMPT = SYSTEM_PROMPT_DEEP_PART_A
import { EnrichedBug } from '../types/index.js'
import { runAgentInvestigation } from './agentLoop.js'

// ─── LLM Client abstraction ───────────────────────────────────────────────────

/**
 * Returns the configured LLM config from environment variables.
 * Can be overridden by passing explicit config.
 */
export function getLLMConfig(override?: Partial<LLMConfig>): LLMConfig {
  const provider = (override?.provider ?? process.env['LLM_PROVIDER'] ?? 'ollama') as LLMProvider

  return {
    provider,
    model: override?.model ?? process.env['LLM_MODEL'] ?? getDefaultModel(provider),
    baseUrl: override?.baseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434',
    apiKey: override?.apiKey ?? getApiKey(provider),
    temperature: override?.temperature ?? 0.1,
    maxTokens: override?.maxTokens ?? 4096,
  }
}

function getDefaultModel(provider: LLMProvider): string {
  switch (provider) {
    case 'ollama': return process.env['OLLAMA_MODEL'] ?? 'mistral'
    case 'anthropic': return 'claude-sonnet-4-6'
    case 'gemini': return 'gemini-2.5-flash'
    case 'openai': return 'gpt-4o-mini'
  }
}

function getApiKey(provider: LLMProvider): string | undefined {
  switch (provider) {
    case 'anthropic': return process.env['ANTHROPIC_API_KEY']
    case 'gemini': return process.env['GEMINI_API_KEY']
    case 'openai': return process.env['OPENAI_API_KEY']
    default: return undefined
  }
}

// ─── Raw LLM call ─────────────────────────────────────────────────────────────

/**
 * Sends a prompt to the configured LLM and returns the raw text response.
 * The caller is responsible for JSON validation.
 */
export async function callLLM(
  prompt: string,
  config: LLMConfig,
  images?: Array<{ data: string; mimeType: string; alt?: string }>,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
): Promise<string> {
  switch (config.provider) {
    case 'ollama': return callOllama(prompt, config, systemPrompt)
    case 'anthropic': return callAnthropic(prompt, config, images, systemPrompt)
    case 'gemini': return callGemini(prompt, config, systemPrompt)
    case 'openai': return callOpenAI(prompt, config, systemPrompt)
  }
}

// ─── Provider implementations ─────────────────────────────────────────────────

async function callOllama(prompt: string, config: LLMConfig, systemPrompt: string = DEFAULT_SYSTEM_PROMPT): Promise<string> {
  const baseUrl = config.baseUrl ?? 'http://localhost:11434'
  const model = config.model ?? 'mistral'

  // Usamos /api/chat (chat completion) en lugar de /api/generate (text completion).
  // Los modelos instruct (mistral, llama3, qwen, etc.) respetan mejor el system prompt
  // cuando los mensajes están separados correctamente.
  const body = {
    model,
    stream: false,
    format: 'json',  // grammar-constrained JSON — evita JSON malformado/truncado
    options: {
      temperature: config.temperature ?? 0.1,
      num_predict: config.maxTokens ?? 4096,
    },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: prompt },
    ],
  }

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000), // 3 min — modelos grandes en CPU pueden tardar
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Ollama error ${response.status}: ${text}`)
  }

  const data = (await response.json()) as { message?: { content: string }; response?: string }
  // /api/chat devuelve { message: { content } }
  // fallback a { response } por si algún modelo usa el formato antiguo
  const text = data.message?.content ?? data.response ?? ''
  return text.trim()
}

async function callAnthropic(prompt: string, config: LLMConfig, images?: Array<{ data: string; mimeType: string; alt?: string }>, systemPrompt: string = DEFAULT_SYSTEM_PROMPT): Promise<string> {
  if (!config.apiKey) throw new Error('ANTHROPIC_API_KEY no configurada')

  const { Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: config.apiKey })

  type SupportedMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  const SUPPORTED_MIMES = new Set<string>(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

  // Build content array — text + optional images (vision)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userContent: any[] = [{ type: 'text', text: prompt }]

  if (images && images.length > 0) {
    for (const img of images.slice(0, 4)) {
      if (!SUPPORTED_MIMES.has(img.mimeType)) continue
      userContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mimeType as SupportedMime,
          data: img.data,
        },
      })
    }
    if (userContent.length > 1) {
      userContent.push({
        type: 'text',
        text: 'Las imágenes de arriba son capturas de pantalla del documento de evidencia del bug. Usálas para entender mejor el problema.',
      })
    }
  }

  const message = await client.messages.create({
    model: config.model ?? 'claude-sonnet-4-6',
    max_tokens: config.maxTokens ?? 4096,
    system: systemPrompt,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [{ role: 'user', content: userContent as any }],
    temperature: config.temperature ?? 0.1,
  })

  const content = message.content[0]
  if (!content || content.type !== 'text') throw new Error('Anthropic: respuesta vacía')
  return content.text.trim()
}

async function callGemini(prompt: string, config: LLMConfig, systemPrompt: string = DEFAULT_SYSTEM_PROMPT): Promise<string> {
  if (!config.apiKey) throw new Error('GEMINI_API_KEY no configurada')

  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(config.apiKey)

  const model = genAI.getGenerativeModel({
    model: config.model ?? 'gemini-2.5-flash',
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: config.temperature ?? 0.1,
      maxOutputTokens: config.maxTokens ?? 4096,
      responseMimeType: 'application/json',
    },
  })

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const result = await model.generateContent(prompt)
      return result.response.text().trim()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if ((msg.includes('429') || msg.includes('Too Many Requests')) && attempt < 4) {
        const match = msg.match(/"retryDelay":"(\d+)s"/)
        const waitMs = match ? parseInt(match[1]) * 1000 : attempt * 20_000
        console.warn(`[gemini] 429 rate limit — esperando ${waitMs / 1000}s (intento ${attempt}/4)`)
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      throw err
    }
  }
  throw new Error('Gemini: máximo de reintentos alcanzado')
}

async function callOpenAI(prompt: string, config: LLMConfig, systemPrompt: string = DEFAULT_SYSTEM_PROMPT): Promise<string> {
  if (!config.apiKey) throw new Error('OPENAI_API_KEY no configurada')

  const { OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey: config.apiKey })

  const completion = await client.chat.completions.create({
    model: config.model ?? 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    temperature: config.temperature ?? 0.1,
    max_tokens: config.maxTokens ?? 2048,
    response_format: { type: 'json_object' },
  })

  const text = completion.choices[0]?.message.content ?? ''
  return text.trim()
}

// ─── JSON validation & retry ──────────────────────────────────────────────────

const VALID_CATEGORIES = new Set(['frontend', 'backend', 'database', 'config', 'data', 'insufficient_info'])
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical'])
const VALID_DIFFICULTIES = new Set(['low', 'medium', 'high'])

// Escape bare control characters inside JSON string values (Gemini sometimes emits them)
function sanitizeJSONStrings(text: string): string {
  let result = ''
  let inString = false
  let escaped = false
  for (const char of text) {
    if (escaped) { result += char; escaped = false; continue }
    if (char === '\\' && inString) { result += char; escaped = true; continue }
    if (char === '"') { result += char; inString = !inString; continue }
    if (inString) {
      const code = char.charCodeAt(0)
      if (char === '\n') { result += '\\n'; continue }
      if (char === '\r') { result += '\\r'; continue }
      if (char === '\t') { result += '\\t'; continue }
      if (code < 0x20) { result += ' '; continue }
    }
    result += char
  }
  return result
}

function extractJSON(text: string): string {
  const stripped = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  const json = (start !== -1 && end !== -1) ? stripped.slice(start, end + 1) : stripped
  return sanitizeJSONStrings(json)
}

function toStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return []
  return val.map(String).filter(Boolean)
}

// qwen2.5 con format:json a veces devuelve probableCause como objeto {OBSERVACIÓN, HIPÓTESIS, CERTEZA}
function parseProbableCause(val: unknown): string {
  if (typeof val === 'string') return val
  if (typeof val === 'object' && val !== null) {
    const pc = val as Record<string, unknown>
    return ['OBSERVACIÓN', 'HIPÓTESIS', 'CERTEZA']
      .filter((k) => pc[k])
      .map((k) => `${k}: ${pc[k]}`)
      .join('\n')
  }
  return ''
}

// ─── Helpers for new structured fields ───────────────────────────────────────

function parseProblemDescription(val: unknown): BugAnalysis['problemDescription'] | undefined {
  if (typeof val !== 'object' || val === null) return undefined
  const p = val as Record<string, unknown>
  return {
    originalReport:     String(p['originalReport']     ?? ''),
    documentSummary:    String(p['documentSummary']    ?? ''),
    observedBehavior:   String(p['observedBehavior']   ?? ''),
    expectedBehavior:   String(p['expectedBehavior']   ?? ''),
    reproductionSteps:  toStringArray(p['reproductionSteps']),
    affectedRoute:      String(p['affectedRoute']      ?? ''),
    environment:        String(p['environment']        ?? ''),
    sources:            toStringArray(p['sources']),
  }
}

function parseStructuredCause(val: unknown): BugAnalysis['structuredCause'] | undefined {
  if (typeof val !== 'object' || val === null) return undefined
  const c = val as Record<string, unknown>
  return {
    observation: String(c['observation'] ?? ''),
    hypothesis:  String(c['hypothesis']  ?? ''),
    evidence:    toStringArray(c['evidence']),
    risk:        String(c['risk']        ?? ''),
  }
}

function parseWhyNotOther(val: unknown): BugAnalysis['whyNotOtherCategories'] | undefined {
  if (!Array.isArray(val)) return undefined
  const out: NonNullable<BugAnalysis['whyNotOtherCategories']> = []
  for (const item of val) {
    if (typeof item !== 'object' || item === null) continue
    const i = item as Record<string, unknown>
    if (!i['category']) continue
    out.push({ category: String(i['category']), reason: String(i['reason'] ?? '') })
  }
  return out.length > 0 ? out : undefined
}

// ─── New deep-only parsers ───────────────────────────────────────────────────

const VALID_INCONSISTENCY_TYPES = new Set([
  'route_mismatch', 'module_mismatch', 'category_conflict',
  'missing_evidence', 'naming_mismatch', 'other',
])
const VALID_PROBABILITIES = new Set(['high', 'medium', 'low'])

function parseSnippets(val: unknown): BugAnalysis['relatedFilesWithReasons'][0]['relevantSnippets'] {
  if (!Array.isArray(val)) return undefined
  const out: NonNullable<BugAnalysis['relatedFilesWithReasons'][0]['relevantSnippets']> = []
  for (const item of val) {
    if (typeof item !== 'object' || item === null) continue
    const i = item as Record<string, unknown>
    const start = Number(i['startLine'])
    const end   = Number(i['endLine'])
    const code  = String(i['code'] ?? '')
    if (!code.trim()) continue
    out.push({
      startLine: isNaN(start) ? 1 : start,
      endLine:   isNaN(end)   ? start : end,
      code,
      whyRelevant: String(i['whyRelevant'] ?? ''),
    })
  }
  return out.length > 0 ? out : undefined
}

function parseInconsistencies(val: unknown): BugAnalysis['detectedInconsistencies'] {
  if (!Array.isArray(val)) return undefined
  const out: NonNullable<BugAnalysis['detectedInconsistencies']> = []
  for (const item of val) {
    if (typeof item !== 'object' || item === null) continue
    const i = item as Record<string, unknown>
    const type = String(i['type'] ?? 'other')
    if (!i['description']) continue
    out.push({
      type: (VALID_INCONSISTENCY_TYPES.has(type) ? type : 'other') as NonNullable<BugAnalysis['detectedInconsistencies']>[0]['type'],
      description: String(i['description']),
      impact: String(i['impact'] ?? ''),
      evidence: toStringArray(i['evidence']),
    })
  }
  return out.length > 0 ? out : undefined
}

function parseHypotheses(val: unknown): BugAnalysis['hypotheses'] {
  if (!Array.isArray(val)) return undefined
  const out: NonNullable<BugAnalysis['hypotheses']> = []
  for (const item of val) {
    if (typeof item !== 'object' || item === null) continue
    const i = item as Record<string, unknown>
    const prob = String(i['probability'] ?? 'medium')
    if (!i['title']) continue
    out.push({
      title: String(i['title']),
      probability: (VALID_PROBABILITIES.has(prob) ? prob : 'medium') as NonNullable<BugAnalysis['hypotheses']>[0]['probability'],
      evidence: toStringArray(i['evidence']),
      howToValidate: toStringArray(i['howToValidate']),
    })
  }
  // Ordenar high → medium → low (estable)
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 }
  out.sort((a, b) => rank[a.probability] - rank[b.probability])
  return out.length > 0 ? out : undefined
}

function parseSuggestedFix(val: unknown): BugAnalysis['suggestedFix'] {
  if (typeof val !== 'object' || val === null) return undefined
  const f = val as Record<string, unknown>
  const summary  = String(f['summary']   ?? '')
  const steps    = toStringArray(f['steps'])
  const dependsOn = String(f['dependsOn'] ?? '')
  if (!summary && steps.length === 0) return undefined
  return { summary, steps, dependsOn }
}

// Derive a human-readable probableCause string from the structured form.
// Used as fallback when the model only provided structuredCause.
function deriveProbableCauseString(c: BugAnalysis['structuredCause']): string {
  if (!c) return ''
  const parts: string[] = []
  if (c.observation) parts.push(`OBSERVACIÓN: ${c.observation}`)
  if (c.hypothesis)  parts.push(`HIPÓTESIS: ${c.hypothesis}`)
  if (c.evidence.length > 0) parts.push(`EVIDENCIA: ${c.evidence.join('; ')}`)
  if (c.risk)        parts.push(`RIESGO: ${c.risk}`)
  return parts.join('\n')
}

function validateAnalysis(obj: unknown): BugAnalysis {
  if (typeof obj !== 'object' || obj === null) {
    throw new Error('La respuesta no es un objeto JSON')
  }

  const o = obj as Record<string, unknown>

  if (!VALID_CATEGORIES.has(String(o['category']))) {
    throw new Error(`Categoría inválida: ${o['category']}`)
  }
  if (!VALID_SEVERITIES.has(String(o['severity']))) {
    throw new Error(`Severidad inválida: ${o['severity']}`)
  }
  if (!VALID_DIFFICULTIES.has(String(o['difficulty']))) {
    throw new Error(`Dificultad inválida: ${o['difficulty']}`)
  }

  const confidence = Number(o['confidence'])
  if (isNaN(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`Confianza inválida: ${o['confidence']}`)
  }

  const VALID_SOURCES = new Set(['excel', 'document', 'screenshot', 'code', 'inference', 'missing', 'not_confirmed'])
  const VALID_STRENGTH = new Set(['strong', 'medium', 'weak'])
  const VALID_RELATION = new Set(['classification', 'probable_cause', 'fix', 'missing_info'])

  // relatedFilesWithReasons — supports objects (with new optional fields) or legacy strings
  const relatedFilesWithReasons: BugAnalysis['relatedFilesWithReasons'] = []
  if (Array.isArray(o['relatedFilesWithReasons'])) {
    for (const item of o['relatedFilesWithReasons']) {
      if (typeof item === 'object' && item !== null) {
        const i = item as Record<string, unknown>
        if (!i['path']) continue
        const conf = Number(i['confidence'])
        relatedFilesWithReasons.push({
          path: String(i['path']),
          reason: String(i['reason'] ?? ''),
          relationType: i['relationType'] ? String(i['relationType']) : undefined,
          confidence: !isNaN(conf) && conf >= 0 && conf <= 1 ? conf : undefined,
          whatToCheck: toStringArray(i['whatToCheck']).length > 0 ? toStringArray(i['whatToCheck']) : undefined,
          relevantSnippets: parseSnippets(i['relevantSnippets']),
        })
      } else if (typeof item === 'string' && item) {
        relatedFilesWithReasons.push({ path: item, reason: '' })
      }
    }
  }

  // evidenceUsed — supports new strength + relatedTo fields, falls back gracefully
  const evidenceUsed: BugAnalysis['evidenceUsed'] = []
  if (Array.isArray(o['evidenceUsed'])) {
    for (const item of o['evidenceUsed']) {
      if (typeof item !== 'object' || item === null) continue
      const i = item as Record<string, unknown>
      const source   = String(i['source']   ?? 'inference')
      const strength = String(i['strength'] ?? '')
      const related  = String(i['relatedTo'] ?? '')
      evidenceUsed.push({
        source: (VALID_SOURCES.has(source) ? source : 'inference') as BugAnalysis['evidenceUsed'][0]['source'],
        description: String(i['description'] ?? ''),
        strength: VALID_STRENGTH.has(strength) ? strength as BugAnalysis['evidenceUsed'][0]['strength'] : undefined,
        relatedTo: VALID_RELATION.has(related) ? related as BugAnalysis['evidenceUsed'][0]['relatedTo'] : undefined,
      })
    }
  }

  const relatedFiles = relatedFilesWithReasons.map((f) => f.path)

  const structuredCause = parseStructuredCause(o['structuredCause'])
  // If the model didn't produce probableCause but did produce structuredCause, derive it
  const probableCauseString = parseProbableCause(o['probableCause'])
  const probableCause = probableCauseString || deriveProbableCauseString(structuredCause) || ''

  return {
    category: o['category'] as BugAnalysis['category'],
    severity: o['severity'] as BugAnalysis['severity'],
    difficulty: o['difficulty'] as BugAnalysis['difficulty'],
    confidence,
    bugType: o['bugType'] ? String(o['bugType']) : undefined,

    analysisStatus: 'deep_completed',

    summary: String(o['summary'] ?? ''),
    affectedArea: String(o['affectedArea'] ?? ''),

    problemDescription: parseProblemDescription(o['problemDescription']),
    functionalImpact: o['functionalImpact'] ? String(o['functionalImpact']) : undefined,

    classificationReason: String(o['classificationReason'] ?? ''),
    confidenceReason: String(o['confidenceReason'] ?? ''),
    whyNotOtherCategories: parseWhyNotOther(o['whyNotOtherCategories']),

    probableCause,
    structuredCause,

    suggestedFixSteps: toStringArray(o['suggestedFixSteps']),
    investigationSteps: toStringArray(o['investigationSteps']),
    evidenceUsed,

    cannotConclude: toStringArray(o['cannotConclude']),
    missingInformation: toStringArray(o['missingInformation']).length > 0
      ? toStringArray(o['missingInformation']) : undefined,

    relatedFilesWithReasons,
    relatedFiles,

    // ─── Deep-only fields ──────────────────────────────────────────────────
    detectedInconsistencies: parseInconsistencies(o['detectedInconsistencies']),
    hypotheses: parseHypotheses(o['hypotheses']),
    suggestedFix: parseSuggestedFix(o['suggestedFix']),
    finalRecommendation: o['finalRecommendation'] ? String(o['finalRecommendation']) : undefined,

    manualValidationNeeded: typeof o['manualValidationNeeded'] === 'boolean'
      ? o['manualValidationNeeded'] : undefined,
    needsMoreInfo: Boolean(o['needsMoreInfo']),
    rawResponse: JSON.stringify(obj),
  }
}

/**
 * Analyzes an enriched bug.
 * If repoPaths are provided, runs an agentic investigation first (the LLM
 * uses grep/read_file tools to navigate the repo), then does the final analysis.
 * Retries once if the response isn't valid JSON.
 */
// Helper: corre una sola llamada LLM con reintento, devuelve el JSON parseado crudo.
async function runLLMCall(
  prompt:       string,
  systemPrompt: string,
  config:       LLMConfig,
  images:       Array<{ data: string; mimeType: string; alt?: string }> | undefined,
  label:        string,
  sendLog?:     (msg: string) => void,
): Promise<Record<string, unknown>> {
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await callLLM(prompt, config, images, systemPrompt)
      const json = JSON.parse(extractJSON(raw)) as Record<string, unknown>
      return json
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      sendLog?.(`  [${label}] intento ${attempt} falló: ${lastErr.message}`)
      if (attempt === 1) await new Promise((r) => setTimeout(r, 1000))
    }
  }
  throw lastErr ?? new Error(`${label}: failed after retries`)
}

// Merge: combina los JSONs de las 2 llamadas en un único objeto para validateAnalysis.
// Si una llamada da un campo y la otra el mismo, gana la que lo definió no-vacío.
function mergeDeepResults(partA: Record<string, unknown>, partB: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...partA }
  for (const [k, v] of Object.entries(partB)) {
    if (v === undefined || v === null) continue
    if (typeof v === 'string' && v === '') continue
    if (Array.isArray(v) && v.length === 0 && merged[k]) continue
    merged[k] = v
  }
  return merged
}

export async function analyzeBug(
  enriched:  EnrichedBug,
  config:    LLMConfig,
  repoPaths: string[]    = [],
  sendLog?:  (msg: string) => void,
  cacheDir?: string,
): Promise<BugAnalysis> {
  // Cache check (deep analysis): si el bug + docs + modelo + prompt version no cambiaron,
  // devolvemos el análisis cacheado. La inversión vale la pena para el deep porque
  // cada uno tarda 2-4 min.
  const cacheKey = cacheDir ? makeCacheKey(enriched, config, 'deep') : null
  if (cacheKey && cacheDir) {
    const cached = loadCachedAnalysis(cacheKey, cacheDir)
    if (cached) {
      sendLog?.('  ✓ deep analysis desde cache')
      return cached
    }
  }

  // Phase 1: agentic investigation — LLM navigates the repo with tools
  let gatheredCode = ''
  if (repoPaths.filter(Boolean).length > 0) {
    const { gatheredCode: code, toolCallCount, toolLog } = await runAgentInvestigation(
      enriched, config, repoPaths, sendLog
    )
    gatheredCode = code
    if (toolCallCount > 0) {
      sendLog?.(`  Investigación: ${toolCallCount} consultas (${toolLog.map((l) => l.split('(')[0]).join(', ')})`)
    }
  }

  // Phase 2: ANÁLISIS EN 2 LLAMADAS
  // - PART A: descripción + diagnóstico (problemDescription, structuredCause, evidence, classification)
  // - PART B: plan accionable (hypotheses, inconsistencies, files+snippets, fix, recommendation)
  // Cada call tiene ~10 campos, manejable para qwen2.5:7b. Luego mergeamos.
  const userPrompt = buildUserPrompt(enriched, gatheredCode)
  const allImages = enriched.googleDocs.flatMap((d) => d.images ?? []).slice(0, 4)
  const imgs = allImages.length > 0 ? allImages : undefined

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      sendLog?.('  → PART A: descripción + diagnóstico')
      const partA = await runLLMCall(userPrompt, SYSTEM_PROMPT_DEEP_PART_A, config, imgs, 'PART_A', sendLog)
      sendLog?.('  → PART B: hipótesis + plan + recomendación')
      const partB = await runLLMCall(userPrompt, SYSTEM_PROMPT_DEEP_PART_B, config, imgs, 'PART_B', sendLog)
      const merged = mergeDeepResults(partA, partB)
      const analysis = validateAnalysis(merged)
      if (cacheKey && cacheDir) saveCachedAnalysis(cacheKey, cacheDir, analysis)
      return analysis
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.warn(`[llm] Intento ${attempt} fallido para bug ${enriched.raw.id}:`, lastError.message)

      if (attempt === 1) {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
  }

  // Both attempts failed — return a default "error" analysis
  return {
    category: 'insufficient_info',
    severity: 'low',
    difficulty: 'low',
    confidence: 0,
    analysisStatus: 'failed',
    summary: 'No se pudo analizar este bug',
    affectedArea: '',
    classificationReason: '',
    confidenceReason: '',
    probableCause: `Error al analizar: ${lastError?.message ?? 'desconocido'}`,
    suggestedFixSteps: [],
    investigationSteps: [],
    evidenceUsed: [],
    cannotConclude: [],
    relatedFilesWithReasons: [],
    relatedFiles: [],
    needsMoreInfo: true,
    rawResponse: lastError?.message ?? '',
  }
}

// Alias semántico: el batch usa fastTriage(), bajo demanda usa deepAnalysis()
export { analyzeBug as deepAnalysis }
