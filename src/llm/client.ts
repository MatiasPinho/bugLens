import { LLMConfig, LLMProvider, BugAnalysis } from '../types/index.js'
import { SYSTEM_PROMPT, buildUserPrompt } from '../prompts/bugClassifier.js'
import { EnrichedBug } from '../types/index.js'

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
    case 'gemini': return 'gemini-1.5-flash'
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
  images?: Array<{ data: string; mimeType: string; alt?: string }>
): Promise<string> {
  switch (config.provider) {
    case 'ollama': return callOllama(prompt, config)
    case 'anthropic': return callAnthropic(prompt, config, images)
    case 'gemini': return callGemini(prompt, config)
    case 'openai': return callOpenAI(prompt, config)
  }
}

// ─── Provider implementations ─────────────────────────────────────────────────

async function callOllama(prompt: string, config: LLMConfig): Promise<string> {
  const baseUrl = config.baseUrl ?? 'http://localhost:11434'
  const model = config.model ?? 'mistral'

  // Usamos /api/chat (chat completion) en lugar de /api/generate (text completion).
  // Los modelos instruct (mistral, llama3, qwen, etc.) respetan mejor el system prompt
  // cuando los mensajes están separados correctamente.
  const body = {
    model,
    stream: false,
    options: {
      temperature: config.temperature ?? 0.1,
      num_predict: config.maxTokens ?? 2048,
    },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
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

async function callAnthropic(prompt: string, config: LLMConfig, images?: Array<{ data: string; mimeType: string; alt?: string }>): Promise<string> {
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
    system: SYSTEM_PROMPT,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: [{ role: 'user', content: userContent as any }],
    temperature: config.temperature ?? 0.1,
  })

  const content = message.content[0]
  if (!content || content.type !== 'text') throw new Error('Anthropic: respuesta vacía')
  return content.text.trim()
}

async function callGemini(prompt: string, config: LLMConfig): Promise<string> {
  if (!config.apiKey) throw new Error('GEMINI_API_KEY no configurada')

  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(config.apiKey)

  const model = genAI.getGenerativeModel({
    model: config.model ?? 'gemini-1.5-flash',
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: config.temperature ?? 0.1,
      maxOutputTokens: config.maxTokens ?? 2048,
    },
  })

  const result = await model.generateContent(prompt)
  const text = result.response.text()
  return text.trim()
}

async function callOpenAI(prompt: string, config: LLMConfig): Promise<string> {
  if (!config.apiKey) throw new Error('OPENAI_API_KEY no configurada')

  const { OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey: config.apiKey })

  const completion = await client.chat.completions.create({
    model: config.model ?? 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
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

function extractJSON(text: string): string {
  // Strip markdown code blocks if the LLM added them anyway
  const stripped = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim()

  // Find the first complete JSON object
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start !== -1 && end !== -1) {
    return stripped.slice(start, end + 1)
  }
  return stripped
}

function toStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return []
  return val.map(String).filter(Boolean)
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

  // Parse relatedFilesWithReasons — support both array of objects and legacy array of strings
  const VALID_SOURCES = new Set(['excel', 'document', 'screenshot', 'code', 'inference', 'missing'])

  const relatedFilesWithReasons: BugAnalysis['relatedFilesWithReasons'] = []
  if (Array.isArray(o['relatedFilesWithReasons'])) {
    for (const item of o['relatedFilesWithReasons']) {
      if (typeof item === 'object' && item !== null) {
        const i = item as Record<string, unknown>
        if (i['path']) relatedFilesWithReasons.push({ path: String(i['path']), reason: String(i['reason'] ?? '') })
      } else if (typeof item === 'string' && item) {
        relatedFilesWithReasons.push({ path: item, reason: '' })
      }
    }
  }

  // Parse evidenceUsed
  const evidenceUsed: BugAnalysis['evidenceUsed'] = []
  if (Array.isArray(o['evidenceUsed'])) {
    for (const item of o['evidenceUsed']) {
      if (typeof item === 'object' && item !== null) {
        const i = item as Record<string, unknown>
        const source = String(i['source'] ?? 'inference')
        evidenceUsed.push({
          source: (VALID_SOURCES.has(source) ? source : 'inference') as BugAnalysis['evidenceUsed'][0]['source'],
          description: String(i['description'] ?? ''),
        })
      }
    }
  }

  // Derive relatedFiles from relatedFilesWithReasons for backward compat
  const relatedFiles = relatedFilesWithReasons.map((f) => f.path)

  return {
    category: o['category'] as BugAnalysis['category'],
    severity: o['severity'] as BugAnalysis['severity'],
    difficulty: o['difficulty'] as BugAnalysis['difficulty'],
    confidence,
    summary: String(o['summary'] ?? ''),
    affectedArea: String(o['affectedArea'] ?? ''),
    classificationReason: String(o['classificationReason'] ?? ''),
    confidenceReason: String(o['confidenceReason'] ?? ''),
    probableCause: String(o['probableCause'] ?? ''),
    suggestedFixSteps: toStringArray(o['suggestedFixSteps']),
    investigationSteps: toStringArray(o['investigationSteps']),
    evidenceUsed,
    cannotConclude: toStringArray(o['cannotConclude']),
    relatedFilesWithReasons,
    relatedFiles,
    needsMoreInfo: Boolean(o['needsMoreInfo']),
    rawResponse: JSON.stringify(obj),
  }
}

/**
 * Analyzes an enriched bug. Retries once if the first response isn't valid JSON.
 */
export async function analyzeBug(
  enriched: EnrichedBug,
  config: LLMConfig
): Promise<BugAnalysis> {
  const userPrompt = buildUserPrompt(enriched)

  // Collect images from Google Docs for vision-capable providers
  const allImages = enriched.googleDocs
    .flatMap((d) => d.images ?? [])
    .slice(0, 4)

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await callLLM(userPrompt, config, allImages.length > 0 ? allImages : undefined)
      const jsonStr = extractJSON(raw)
      const parsed = JSON.parse(jsonStr) as unknown
      const analysis = validateAnalysis(parsed)
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
