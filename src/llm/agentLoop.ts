/**
 * agentLoop.ts
 *
 * Agentic investigation loop: the LLM drives the search using tools
 * (grep, read_file, list_directory) and iterates until it has enough
 * evidence to produce a quality analysis.
 *
 * Supported providers: anthropic, ollama (qwen2.5+ with tool support)
 * Other providers: skip investigation, fall back to embedding search only
 */

import type { LLMConfig, EnrichedBug } from '../types/index.js'
import { TOOL_DEFINITIONS, executeTool } from './agentTools.js'
import { buildUserPrompt } from '../prompts/bugClassifier.js'

const MAX_TOOL_CALLS = 6

export const AGENT_SYSTEM_PROMPT = `Sos un developer senior investigando un bug usando herramientas para leer el código fuente real del proyecto.

ESTRATEGIA DE INVESTIGACIÓN:
1. Identificá los términos clave del bug: nombre de pantalla, componente, función, ruta URL, mensaje de error, variable
2. Empezá SIEMPRE con grep para buscar esos términos en el repo
3. Leé los archivos más relevantes que grep te devuelva
4. Si un archivo hace referencia a otro que parece importante, leélo también
5. Cuando tenés suficiente código real para fundamentar el análisis, PARÁS de usar herramientas

REGLAS:
- Cada afirmación en el análisis final debe basarse en código que vos leíste con las herramientas
- Si el bug menciona una pantalla específica, buscala por nombre antes de cualquier otra cosa
- Usá list_directory solo si no sabés en qué parte del proyecto buscar
- No repitas búsquedas similares — si grep no encontró algo, intentá con un término diferente
- Cuando terminés de investigar, respondé DIRECTAMENTE con el JSON de análisis (sin texto antes ni después)`

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

  // Anthropic tool format: use input_schema directly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: any[] = TOOL_DEFINITIONS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    {
      role: 'user',
      content: `${buildUserPrompt(enriched)}\n\nInvestigá el código usando las herramientas disponibles. Cuando tengas suficiente evidencia del código real, producí el análisis en JSON.`,
    },
  ]

  const gathered: string[] = []
  const toolLog:  string[] = []
  let toolCallCount = 0

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

    if (toolUseBlocks.length === 0) {
      // LLM stopped using tools — investigation complete
      break
    }

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

  // Ollama uses OpenAI-compatible tool format
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

  const messages: OllamaMessage[] = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${buildUserPrompt(enriched)}\n\nInvestigá el código usando las herramientas. Cuando tengas suficiente evidencia, producí el análisis en JSON.`,
    },
  ]

  const gathered: string[] = []
  const toolLog:  string[] = []
  let toolCallCount = 0

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
          options: { temperature: 0.1, num_predict: 2048 },
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

    // Add assistant message to history
    messages.push({ role: msg.role, content: msg.content ?? '', tool_calls: msg.tool_calls })

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // LLM stopped using tools
      break
    }

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

      gathered.push(`### ${callDesc}\n${result}`)

      // Ollama expects tool results as separate messages
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

// ─── Public interface ─────────────────────────────────────────────────────────

export async function runAgentInvestigation(
  enriched:  EnrichedBug,
  config:    LLMConfig,
  repoPaths: string[],
  sendLog?:  (msg: string) => void
): Promise<InvestigationResult> {
  const empty: InvestigationResult = { gatheredCode: '', toolCallCount: 0, toolLog: [] }

  if (repoPaths.filter(Boolean).length === 0) return empty

  sendLog?.(`Agente investigando código (${config.provider})...`)

  try {
    switch (config.provider) {
      case 'anthropic':
        if (!config.apiKey) return empty
        return await anthropicLoop(enriched, config, repoPaths, sendLog)

      case 'ollama':
        return await ollamaLoop(enriched, config, repoPaths, sendLog)

      default:
        // OpenAI / Gemini: skip agent loop for now, use embedding search only
        return empty
    }
  } catch (err) {
    sendLog?.(`  [agente] error: ${err instanceof Error ? err.message : String(err)}`)
    return empty
  }
}
