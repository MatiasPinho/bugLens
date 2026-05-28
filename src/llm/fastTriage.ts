/**
 * fastTriage.ts
 *
 * Análisis rápido para todos los bugs del batch:
 *  - Sin agent loop (no tool calls)
 *  - Sin lectura completa de archivos
 *  - candidateFiles se obtiene con grep local (sin LLM)
 *  - Prompt mínimo → output de ~200 tokens en vez de ~2000
 *  - Sin imágenes
 *
 * Objetivo: ~6-10s por bug en Ollama qwen2.5:7b vs ~200s del deep analysis.
 */

import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import type { LLMConfig, EnrichedBug, BugTriage, BugAnalysis } from '../types/index.js'

// ─── Prompt minimal ──────────────────────────────────────────────────────────

const FAST_TRIAGE_PROMPT = `Sos un asistente de triage RÁPIDO de bugs. Tu trabajo es clasificar — no hacer análisis profundo.
Respondé SOLO un JSON con estos campos. Todo en español. Una oración por campo.

{
  "category": "frontend" | "backend" | "database" | "config" | "data" | "insufficient_info",
  "bugType": "ui" | "validation" | "routing" | "permissions" | "api" | "database" | "configuration" | "data_quality" | "unknown",
  "severity": "low" | "medium" | "high" | "critical",
  "difficulty": "low" | "medium" | "high",
  "confidence": 0.0-1.0,
  "summary": "una oración: qué está roto",
  "affectedArea": "componente/módulo/ruta específica",
  "oneLineReason": "por qué esta categoría en una sola oración",
  "needsMoreInfo": true | false
}

Reglas:
- UNA oración por campo. No descripciones largas.
- No inventes archivos, rutas o roles.
- Confianza alta solo si el reporte es claro y específico.
- Si falta información clave (no se sabe qué pasa o qué debería pasar): confidence ≤0.5 y category "insufficient_info".

Categorías:
- frontend: UI, CSS, navegación, formularios, validaciones cliente, templates
- backend: API, lógica servidor, auth, jobs
- database: queries, índices, datos
- config: env, docker, rutas, permisos
- data: datos corruptos como input
- insufficient_info: no hay evidencia suficiente

Severidad:
- critical: sistema caído / pérdida datos / seguridad
- high: funcionalidad clave rota sin workaround
- medium: secundaria afectada o con workaround
- low: cosmético / menor

Respondé SOLO el JSON.`

// ─── Candidate files (búsqueda local, sin LLM) ───────────────────────────────

const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'coverage', '.venv', 'vendor']
const CODE_EXTS   = ['ts', 'tsx', 'js', 'html', 'css', 'scss', 'py', 'java', 'go', 'sql']

/**
 * Extrae términos de búsqueda del bug — sin LLM.
 * Prioriza: ruta de la URL, título, palabras del documento.
 */
function extractSearchTerms(enriched: EnrichedBug): string[] {
  const terms: string[] = []
  const seen = new Set<string>()

  const add = (t: string) => {
    const clean = t.trim().toLowerCase()
    if (clean.length < 4 || seen.has(clean)) return
    seen.add(clean)
    terms.push(t.trim())
  }

  // 1. Segmento final de la URL (más específico)
  const vistaUrl = Object.values(enriched.raw.rawRow).find((v) =>
    /localhost:\d+|:\d+\/[a-z]|gcba\.gob\.ar/.test(v ?? '')
  ) ?? ''
  if (vistaUrl) {
    const urlPath = vistaUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    const segments = urlPath.split('/').filter(Boolean)
    const last = segments[segments.length - 1]
    if (last && last.length > 3) {
      add(last)
      const pascal = last.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
      add(pascal)
    }
  }

  // 2. Título del bug
  const title = enriched.raw.title.trim()
  if (title && !/^bug\s*#?\d+$/i.test(title)) {
    add(title)
  }

  return terms.slice(0, 4)
}

/**
 * Busca archivos candidatos en los repos usando grep — sin LLM.
 * Returns paths relativos a la raíz del repo, top 5.
 */
function findCandidateFiles(enriched: EnrichedBug, repoPaths: string[]): string[] {
  if (repoPaths.length === 0) return []
  const validRepos = repoPaths.filter((p) => fs.existsSync(p))
  if (validRepos.length === 0) return []

  const terms = extractSearchTerms(enriched)
  if (terms.length === 0) return []

  const includeFlags = CODE_EXTS.map((e) => `--include="*.${e}"`).join(' ')
  const excludeFlags = IGNORE_DIRS.map((d) => `--exclude-dir="${d}"`).join(' ')
  const dirsStr = validRepos.map((d) => `"${d}"`).join(' ')

  // Para cada término, grep los archivos que matchean
  const fileScores = new Map<string, number>()

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i]
    const escaped = term.replace(/'/g, "'\\''")
    const weight = terms.length - i  // primeros términos pesan más

    try {
      const cmd = `grep -r -l -i ${includeFlags} ${excludeFlags} '${escaped}' ${dirsStr} 2>/dev/null | head -20`
      const output = execSync(cmd, { timeout: 5000, encoding: 'utf8' })

      for (const line of output.split('\n').filter(Boolean)) {
        // Convertir a path relativo al repo
        let rel = line
        for (const r of validRepos) rel = rel.replace(r + path.sep, '')
        fileScores.set(rel, (fileScores.get(rel) ?? 0) + weight)
      }
    } catch { /* skip */ }
  }

  // Ordenar por score y tomar top 5
  return [...fileScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([p]) => p)
}

// ─── Fast triage prompt builder ──────────────────────────────────────────────

function buildFastTriagePrompt(enriched: EnrichedBug, candidateFiles: string[]): string {
  const { raw, googleDocs } = enriched
  const sections: string[] = []

  sections.push('=== BUG ===')
  sections.push(`Título: ${raw.title}`)
  if (raw.description) sections.push(`Descripción: ${raw.description}`)

  // Campos no estándar (Nombre, Vista, Observaciones, etc.)
  const knownFields = new Set(['Título', 'Title', 'Summary', 'Descripción', 'Description'])
  const extraCols = Object.entries(raw.rawRow).filter(
    ([k, v]) => !knownFields.has(k) && v && v.trim()
  )
  for (const [k, v] of extraCols.slice(0, 5)) {
    sections.push(`${k}: ${String(v).slice(0, 200)}`)
  }

  if (googleDocs.length > 0) {
    const accessible = googleDocs.filter((d) => d.accessible)
    if (accessible.length > 0) {
      sections.push('\n=== DOCUMENTO ===')
      for (const doc of accessible) {
        // Limitar a 1500 chars del documento para que el prompt no sea enorme
        sections.push(doc.text.slice(0, 1500))
        const imgCount = doc.images?.length ?? 0
        if (imgCount > 0) sections.push(`[Documento tiene ${imgCount} captura(s) — no analizadas en fast triage]`)
      }
    }
  }

  if (candidateFiles.length > 0) {
    sections.push('\n=== ARCHIVOS CANDIDATOS (búsqueda local) ===')
    for (const f of candidateFiles) sections.push(`- ${f}`)
  }

  sections.push('\nClasificá el bug. Solo JSON.')
  return sections.join('\n')
}

// ─── Main fastTriage ──────────────────────────────────────────────────────────

const VALID_CATEGORIES   = new Set(['frontend', 'backend', 'database', 'config', 'data', 'insufficient_info'])
const VALID_SEVERITIES   = new Set(['low', 'medium', 'high', 'critical'])
const VALID_DIFFICULTIES = new Set(['low', 'medium', 'high'])

function extractJSON(text: string): string {
  const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  return (start !== -1 && end !== -1) ? stripped.slice(start, end + 1) : stripped
}

/**
 * Llamada cruda a Ollama con el prompt minimal de fast triage.
 * Usa format:'json' para garantizar JSON válido.
 */
async function callOllamaFast(prompt: string, config: LLMConfig): Promise<string> {
  const baseUrl = config.baseUrl ?? 'http://localhost:11434'
  const model   = config.model   ?? 'qwen2.5:7b'

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      options: { temperature: 0.1, num_predict: 512 },  // ← menos tokens
      messages: [
        { role: 'system', content: FAST_TRIAGE_PROMPT },
        { role: 'user',   content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) throw new Error(`Ollama error ${response.status}: ${await response.text()}`)
  const data = (await response.json()) as { message?: { content: string } }
  return (data.message?.content ?? '').trim()
}

async function callCloudFast(prompt: string, config: LLMConfig): Promise<string> {
  // Para cloud providers, reusamos la lógica del client.ts pero con el prompt de fast triage
  // El cloud LLM es lo bastante capaz para producir el formato chico sin issues.
  if (config.provider === 'anthropic') {
    if (!config.apiKey) throw new Error('ANTHROPIC_API_KEY no configurada')
    const { Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: config.apiKey })
    const msg = await client.messages.create({
      model: config.model ?? 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: FAST_TRIAGE_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    })
    const block = msg.content[0]
    if (!block || block.type !== 'text') throw new Error('Anthropic: respuesta vacía')
    return block.text.trim()
  }

  if (config.provider === 'gemini') {
    if (!config.apiKey) throw new Error('GEMINI_API_KEY no configurada')
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(config.apiKey)
    const model = genAI.getGenerativeModel({
      model: config.model ?? 'gemini-2.5-flash',
      systemInstruction: FAST_TRIAGE_PROMPT,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
      },
    })
    const result = await model.generateContent(prompt)
    return result.response.text().trim()
  }

  if (config.provider === 'openai') {
    if (!config.apiKey) throw new Error('OPENAI_API_KEY no configurada')
    const { OpenAI } = await import('openai')
    const client = new OpenAI({ apiKey: config.apiKey })
    const completion = await client.chat.completions.create({
      model: config.model ?? 'gpt-4o-mini',
      messages: [
        { role: 'system', content: FAST_TRIAGE_PROMPT },
        { role: 'user',   content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 512,
      response_format: { type: 'json_object' },
    })
    return (completion.choices[0]?.message.content ?? '').trim()
  }

  throw new Error(`Provider no soportado para fast triage: ${config.provider}`)
}

function validateTriage(obj: unknown, candidateFiles: string[], rawResponse: string): BugTriage {
  if (typeof obj !== 'object' || obj === null) throw new Error('Respuesta no es JSON')
  const o = obj as Record<string, unknown>

  if (!VALID_CATEGORIES.has(String(o['category'])))   throw new Error(`Categoría inválida: ${o['category']}`)
  if (!VALID_SEVERITIES.has(String(o['severity'])))   throw new Error(`Severidad inválida: ${o['severity']}`)
  if (!VALID_DIFFICULTIES.has(String(o['difficulty']))) throw new Error(`Dificultad inválida: ${o['difficulty']}`)

  const confidence = Number(o['confidence'])
  if (isNaN(confidence) || confidence < 0 || confidence > 1) throw new Error(`Confianza inválida: ${o['confidence']}`)

  return {
    category: o['category'] as BugTriage['category'],
    severity: o['severity'] as BugTriage['severity'],
    difficulty: o['difficulty'] as BugTriage['difficulty'],
    confidence,
    bugType: o['bugType'] ? String(o['bugType']) : undefined,
    summary: String(o['summary'] ?? ''),
    affectedArea: String(o['affectedArea'] ?? ''),
    oneLineReason: String(o['oneLineReason'] ?? ''),
    candidateFiles,
    needsMoreInfo: Boolean(o['needsMoreInfo']),
    rawResponse,
  }
}

/**
 * Convierte un BugTriage en un BugAnalysis con analysisStatus='fast_completed'.
 * Los campos del deep analysis quedan vacíos / undefined.
 */
export function triageToAnalysis(t: BugTriage): BugAnalysis {
  return {
    category: t.category,
    severity: t.severity,
    difficulty: t.difficulty,
    confidence: t.confidence,
    bugType: t.bugType,
    analysisStatus: 'fast_completed',
    summary: t.summary,
    affectedArea: t.affectedArea,
    oneLineReason: t.oneLineReason,
    candidateFiles: t.candidateFiles,
    classificationReason: t.oneLineReason,  // alias en fast mode
    confidenceReason: '',
    probableCause: '',
    suggestedFixSteps: [],
    investigationSteps: [],
    evidenceUsed: [],
    cannotConclude: [],
    relatedFilesWithReasons: t.candidateFiles.map((p) => ({ path: p, reason: '' })),
    relatedFiles: t.candidateFiles,
    needsMoreInfo: t.needsMoreInfo,
    rawResponse: t.rawResponse,
  }
}

/**
 * Punto de entrada principal: clasifica un bug rápidamente.
 * No usa agent loop, no procesa imágenes, no genera campos rich.
 */
export async function fastTriage(
  enriched:  EnrichedBug,
  config:    LLMConfig,
  repoPaths: string[]    = [],
): Promise<BugTriage> {
  // 1) Búsqueda local de archivos candidatos (sin LLM, ~100ms)
  const candidateFiles = findCandidateFiles(enriched, repoPaths)

  // 2) Prompt minimal con bug + doc (sin imágenes)
  const prompt = buildFastTriagePrompt(enriched, candidateFiles)

  // 3) LLM call corta (max 512 tokens output)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = config.provider === 'ollama'
        ? await callOllamaFast(prompt, config)
        : await callCloudFast(prompt, config)
      const parsed = JSON.parse(extractJSON(raw)) as unknown
      return validateTriage(parsed, candidateFiles, raw)
    } catch (err) {
      if (attempt === 2) throw err
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  throw new Error('fastTriage: failed after retries')
}
