/**
 * agentLoop.ts
 *
 * Agentic investigation loop: the LLM drives the search using tools
 * (grep, read_file, list_directory) and iterates until it has enough
 * evidence to produce a quality analysis.
 *
 * Supported providers: anthropic, ollama (qwen2.5+ with tool support), gemini
 * Other providers: skip investigation, fall back to embedding search only
 */

import type { LLMConfig, EnrichedBug } from '../types/index.js'
import { TOOL_DEFINITIONS, executeTool } from './agentTools.js'
import { buildUserPrompt } from '../prompts/bugClassifier.js'

const MAX_TOOL_CALLS = 10

export const AGENT_SYSTEM_PROMPT = `Sos un developer senior investigando un bug leyendo el código fuente real del proyecto. Respondé siempre en español.

ESTRATEGIA DE INVESTIGACIÓN:
1. Leé el reporte del bug e identificá los términos clave: nombre de pantalla, componente, función, ruta URL, mensaje de error, variable.
2. Empezá SIEMPRE con grep para buscar esos términos en el repo.
3. Leé los archivos más relevantes que grep devuelva.
4. Si un archivo referencia otro importante, leélo también.
5. Cuando tenés suficiente código real para fundamentar el análisis, PARÁS de usar herramientas.

REGLAS:
- Cada afirmación del análisis final debe basarse en código que leíste con las herramientas.
- Si el bug menciona una pantalla o URL específica, buscala por nombre antes que cualquier otra cosa.
- No repitas búsquedas similares — si grep no encontró nada, probá con otro término.
- Cuando terminés de investigar, respondé DIRECTAMENTE con el JSON de análisis (sin texto antes ni después).`

// ─── Pre-seeding ──────────────────────────────────────────────────────────────

/**
 * Extracts high-signal search terms from the bug before the LLM loop starts.
 * Returns terms ordered by specificity (most specific first).
 */
function extractSeedTerms(enriched: EnrichedBug): string[] {
  const terms: string[] = []
  const seen = new Set<string>()

  function add(t: string) {
    const clean = t.trim()
    if (clean.length < 3 || seen.has(clean.toLowerCase())) return
    seen.add(clean.toLowerCase())
    terms.push(clean)
  }

  // 1. Extract route segment from Vista URL (highest signal)
  //    e.g. "http://localhost:4200/abm/obligated-subjects" → "obligated-subjects"
  const vistaUrl = Object.values(enriched.raw.rawRow).find((v) =>
    /localhost:\d+|:\d+\/[a-z]/.test(v)
  ) ?? ''
  if (vistaUrl) {
    const urlPath = vistaUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    const segments = urlPath.split('/').filter(Boolean)
    // Take the last meaningful segment
    const lastSeg = segments[segments.length - 1]
    if (lastSeg && lastSeg.length > 3) {
      add(lastSeg)                                          // obligated-subjects
      // PascalCase variant: obligated-subjects → ObligatedSubjects
      const pascal = lastSeg.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
      add(pascal)                                           // ObligatedSubjects
      // Also try second-to-last segment as context
      if (segments.length >= 2) add(segments[segments.length - 2])
    }
  }

  // 2. Screen/component name from bug title
  const title = enriched.raw.title.trim()
  if (title && !/^bug\s*#?\d+$/i.test(title)) {
    add(title)
    // PascalCase of title words
    const pascal = title.split(/[\s-_]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
    if (pascal !== title) add(pascal)
  }

  // 3. Key nouns from Google Doc text (first meaningful words)
  for (const doc of enriched.googleDocs) {
    if (!doc.accessible || !doc.text) continue
    // Extract quoted identifiers, camelCase/PascalCase words, and route-like patterns
    const codeWords = doc.text.match(/\b[A-Z][a-zA-Z]{3,}(?:Component|Service|Controller|Module|Repository|Entity|Store|Resolver|Guard|Pipe|Hook|Reducer|Action|Selector)\b/g) ?? []
    for (const w of codeWords.slice(0, 3)) add(w)

    const routes = doc.text.match(/\/[a-z][a-z0-9-]{3,}(?:\/[a-z][a-z0-9-]+)*/g) ?? []
    for (const r of routes.slice(0, 2)) add(r.split('/').filter(Boolean).slice(-1)[0])
  }

  return terms.slice(0, 5) // cap at 5 seed terms
}

/**
 * Runs 1-3 automatic greps before the LLM loop starts.
 * Returns the gathered context as a string the LLM can immediately reason about.
 */
function preseedInvestigation(
  enriched:  EnrichedBug,
  repoPaths: string[],
  sendLog?:  (msg: string) => void
): { gathered: string[]; toolLog: string[]; toolCallCount: number } {
  const terms     = extractSeedTerms(enriched)
  const gathered: string[] = []
  const toolLog:  string[] = []
  let toolCallCount = 0

  for (const term of terms.slice(0, 3)) {
    const callDesc = `grep({"pattern":"${term}"})`
    toolLog.push(callDesc)
    toolCallCount++

    const result = executeTool('grep', { pattern: term }, repoPaths)
    if (!result.includes('[Sin resultados') && !result.includes('[Error')) {
      sendLog?.(`  🌱 pre-seed: ${callDesc}`)
      const preview = result.split('\n').slice(0, 2).join(' ').slice(0, 120)
      sendLog?.(`     → ${preview}`)
      gathered.push(`### ${callDesc}\n${result}`)
      break // one good hit is enough as seed — the LLM drives from here
    }
  }

  return { gathered, toolLog, toolCallCount }
}

// ─── Result type ──────────────────────────────────────────────────────────────

export interface InvestigationResult {
  gatheredCode: string
  toolCallCount: number
  toolLog: string[]
}

// ─── Anthropic agent loop ─────────────────────────────────────────────────────

async function anthropicLoop(
  enriched:  EnrichedBug,
  config:    LLMConfig,
  repoPaths: string[],
  sendLog?:  (msg: string) => void
): Promise<InvestigationResult> {
  const { Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: config.apiKey })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: any[] = TOOL_DEFINITIONS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }))

  const seed = preseedInvestigation(enriched, repoPaths, sendLog)
  const gathered: string[] = [...seed.gathered]
  const toolLog:  string[] = [...seed.toolLog]
  let toolCallCount = seed.toolCallCount

  const seedContext = gathered.length > 0
    ? `\n\nBúsqueda inicial ya realizada (NO repetir estos greps):\n${gathered.join('\n\n')}`
    : ''

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    {
      role: 'user',
      content: `${buildUserPrompt(enriched)}${seedContext}\n\nInvestigá el código usando las herramientas disponibles. Cuando tengas suficiente evidencia del código real, producí el análisis en JSON.`,
    },
  ]

  for (let iter = 0; iter < MAX_TOOL_CALLS + 2; iter++) {
    const response = await client.messages.create({
      model:      config.model ?? 'claude-sonnet-4-6',
      max_tokens: 2048,
      system:     AGENT_SYSTEM_PROMPT,
      tools,
      messages,
    })

    messages.push({ role: 'assistant', content: response.content })

    const toolUseBlocks = response.content.filter((b: { type: string }) => b.type === 'tool_use')
    if (toolUseBlocks.length === 0) break

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolResults: any[] = []

    for (const block of toolUseBlocks as Array<{ type: string; id: string; name: string; input: Record<string, unknown> }>) {
      if (toolCallCount >= MAX_TOOL_CALLS) break
      toolCallCount++

      const callDesc = `${block.name}(${JSON.stringify(block.input).slice(0, 100)})`
      sendLog?.(`  🔍 ${callDesc}`)
      toolLog.push(callDesc)

      const result = executeTool(block.name, block.input, repoPaths)
      const preview = result.split('\n').slice(0, 3).join(' ').slice(0, 120)
      sendLog?.(`     → ${preview}${result.length > 120 ? '...' : ''}`)

      if (!result.startsWith('[Sin resultados') && !result.startsWith('[Archivo no encontrado') && !result.startsWith('[Error'))
        gathered.push(`### ${callDesc}\n${result}`)
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
    }

    messages.push({ role: 'user', content: toolResults })
    if (toolCallCount >= MAX_TOOL_CALLS) break
  }

  return { gatheredCode: gathered.join('\n\n'), toolCallCount, toolLog }
}

// ─── Ollama agent loop ────────────────────────────────────────────────────────

async function ollamaLoop(
  enriched:  EnrichedBug,
  config:    LLMConfig,
  repoPaths: string[],
  sendLog?:  (msg: string) => void
): Promise<InvestigationResult> {
  const baseUrl = config.baseUrl ?? 'http://localhost:11434'
  const model   = config.model  ?? 'qwen2.5:7b'

  const tools = TOOL_DEFINITIONS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))

  type OllamaMessage = {
    role: string
    content: string
    tool_calls?: Array<{ id?: string; type?: string; function: { name: string; arguments: string | Record<string, unknown> } }>
    tool_call_id?: string
  }

  const seed = preseedInvestigation(enriched, repoPaths, sendLog)
  const gathered: string[] = [...seed.gathered]
  const toolLog:  string[] = [...seed.toolLog]
  let toolCallCount = seed.toolCallCount

  const seedContext = gathered.length > 0
    ? `\n\nBúsqueda inicial ya realizada (NO repetir estos greps):\n${gathered.join('\n\n')}`
    : ''

  const messages: OllamaMessage[] = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${buildUserPrompt(enriched)}${seedContext}\n\nInvestigá el código usando las herramientas. Cuando tengas suficiente evidencia del código real, producí el análisis en JSON.`,
    },
  ]

  for (let iter = 0; iter < MAX_TOOL_CALLS + 2; iter++) {
    let response: Response
    try {
      response = await fetch(`${baseUrl}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          model,
          stream:  false,
          tools,
          messages,
          options: { temperature: 0.1, num_predict: 4096 },
        }),
        signal: AbortSignal.timeout(120_000),
      })
    } catch {
      break
    }

    if (!response.ok) break

    type OllamaResp = {
      message?: {
        role: string
        content: string
        tool_calls?: Array<{ id?: string; function: { name: string; arguments: string | Record<string, unknown> } }>
      }
    }

    const data = await response.json() as OllamaResp
    const msg  = data.message
    if (!msg) break

    messages.push({ role: msg.role, content: msg.content ?? '', tool_calls: msg.tool_calls })

    if (!msg.tool_calls || msg.tool_calls.length === 0) break

    for (const tc of msg.tool_calls) {
      if (toolCallCount >= MAX_TOOL_CALLS) break
      toolCallCount++

      const args: Record<string, unknown> =
        typeof tc.function.arguments === 'string'
          ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
          : tc.function.arguments

      const callDesc = `${tc.function.name}(${JSON.stringify(args).slice(0, 100)})`
      sendLog?.(`  🔍 ${callDesc}`)
      toolLog.push(callDesc)

      const result = executeTool(tc.function.name, args, repoPaths)
      const preview = result.split('\n').slice(0, 3).join(' ').slice(0, 120)
      sendLog?.(`     → ${preview}${result.length > 120 ? '...' : ''}`)

      if (!result.startsWith('[Sin resultados') && !result.startsWith('[Archivo no encontrado') && !result.startsWith('[Error'))
        gathered.push(`### ${callDesc}\n${result}`)

      messages.push({
        role:         'tool',
        content:      result,
        tool_call_id: tc.id ?? tc.function.name,
      })
    }

    if (toolCallCount >= MAX_TOOL_CALLS) break
  }

  return { gatheredCode: gathered.join('\n\n'), toolCallCount, toolLog }
}

// ─── Gemini agent loop ────────────────────────────────────────────────────────

async function geminiLoop(
  enriched:  EnrichedBug,
  config:    LLMConfig,
  repoPaths: string[],
  sendLog?:  (msg: string) => void
): Promise<InvestigationResult> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const genAI = new GoogleGenerativeAI(config.apiKey!)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const functionDeclarations: any[] = TOOL_DEFINITIONS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }))

  const model = genAI.getGenerativeModel({
    model: config.model ?? 'gemini-2.5-flash',
    systemInstruction: AGENT_SYSTEM_PROMPT,
    tools: [{ functionDeclarations }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
  })

  const seed = preseedInvestigation(enriched, repoPaths, sendLog)
  const gathered: string[] = [...seed.gathered]
  const toolLog:  string[] = [...seed.toolLog]
  let toolCallCount = seed.toolCallCount

  const seedContext = gathered.length > 0
    ? `\n\nBúsqueda inicial ya realizada (NO repetir estos greps):\n${gathered.join('\n\n')}`
    : ''

  const chat = model.startChat()

  async function sendWithRetry(msg: Parameters<typeof chat.sendMessage>[0]) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        return await chat.sendMessage(msg)
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err)
        if ((text.includes('429') || text.includes('Too Many Requests')) && attempt < 4) {
          const match = text.match(/"retryDelay":"(\d+)s"/)
          const waitMs = match ? parseInt(match[1]) * 1000 : attempt * 20_000
          sendLog?.(`  [gemini] 429 — esperando ${waitMs / 1000}s`)
          await new Promise((r) => setTimeout(r, waitMs))
          continue
        }
        throw err
      }
    }
    throw new Error('Gemini agentLoop: máximo de reintentos alcanzado')
  }

  let response = await sendWithRetry(
    `${buildUserPrompt(enriched)}${seedContext}\n\nInvestigá el código usando las herramientas. Cuando tengas suficiente evidencia del código real, producí el análisis en JSON.`
  )

  for (let iter = 0; iter < MAX_TOOL_CALLS + 2; iter++) {
    const calls = response.response.functionCalls()
    if (!calls || calls.length === 0) break

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolResults: any[] = []

    for (const call of calls) {
      if (toolCallCount >= MAX_TOOL_CALLS) break
      toolCallCount++

      const args = call.args as Record<string, unknown>
      const callDesc = `${call.name}(${JSON.stringify(args).slice(0, 100)})`
      sendLog?.(`  🔍 ${callDesc}`)
      toolLog.push(callDesc)

      const result = executeTool(call.name, args, repoPaths)
      const preview = result.split('\n').slice(0, 3).join(' ').slice(0, 120)
      sendLog?.(`     → ${preview}${result.length > 120 ? '...' : ''}`)

      gathered.push(`### ${callDesc}\n${result}`)
      toolResults.push({ functionResponse: { name: call.name, response: { result } } })
    }

    if (toolCallCount >= MAX_TOOL_CALLS) break
    response = await sendWithRetry(toolResults)
  }

  return { gatheredCode: gathered.join('\n\n'), toolCallCount, toolLog }
}

// ─── Public interface ─────────────────────────────────────────────────────────

export async function runAgentInvestigation(
  enriched:  EnrichedBug,
  config:    LLMConfig,
  repoPaths: string[],
  sendLog?:  (msg: string) => void
): Promise<InvestigationResult> {
  const empty: InvestigationResult = { gatheredCode: '', toolCallCount: 0, toolLog: [] }

  if (repoPaths.filter(Boolean).length === 0) return empty

  sendLog?.(`Agente investigando código (${config.provider} / ${config.model ?? 'default'})...`)

  try {
    switch (config.provider) {
      case 'anthropic':
        if (!config.apiKey) return empty
        return await anthropicLoop(enriched, config, repoPaths, sendLog)

      case 'ollama':
        return await ollamaLoop(enriched, config, repoPaths, sendLog)

      case 'gemini':
        if (!config.apiKey) return empty
        return await geminiLoop(enriched, config, repoPaths, sendLog)

      default:
        return empty
    }
  } catch (err) {
    sendLog?.(`  [agente] error: ${err instanceof Error ? err.message : String(err)}`)
    return empty
  }
}
