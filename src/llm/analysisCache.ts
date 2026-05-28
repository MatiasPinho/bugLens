/**
 * analysisCache.ts
 *
 * Cache de resultados de fast triage y deep analysis.
 * Clave: SHA-256 de (bug content + doc content + model + provider + prompt version).
 *
 * Si nada del input cambió, no llamamos al LLM. La inversión amortiza:
 *  - Re-correr el mismo Excel → 0 llamadas LLM
 *  - Mismo bug, modelo distinto → cache miss, recálculo
 *  - Misma config, prompt actualizado → cache miss (bump PROMPT_VERSION)
 */

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import type { EnrichedBug, BugTriage, BugAnalysis, LLMConfig } from '../types/index.js'

// Bump cuando cambia un prompt — invalida cache vieja para forzar recálculo.
const PROMPT_VERSION = 'v3-2025-05'

// ─── Key generation ──────────────────────────────────────────────────────────

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 32)
}

/**
 * Computa la clave de cache para un bug + configuración.
 * Idempotente: mismo input → misma clave → mismo resultado cacheado.
 */
export function makeCacheKey(
  enriched: EnrichedBug,
  config:   LLMConfig,
  kind:     'fast' | 'deep'
): string {
  const bug = enriched.raw
  // Contenido del bug que afecta el análisis
  const bugParts = [
    bug.id,
    bug.title,
    bug.description ?? '',
    JSON.stringify(bug.rawRow),
    bug.stepsToReproduce ?? '',
    bug.expectedResult ?? '',
    bug.actualResult ?? '',
  ].join('|')

  // Contenido de los documentos accesibles (texto, no URLs)
  const docParts = enriched.googleDocs
    .filter((d) => d.accessible)
    .map((d) => `${d.title}::${d.text}`)
    .join('||')

  const modelKey = `${config.provider}/${config.model ?? 'default'}`

  return sha256([kind, PROMPT_VERSION, modelKey, bugParts, docParts].join('|'))
}

// ─── Storage ──────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  cachedAt: string  // ISO timestamp
  key: string
  kind: 'fast' | 'deep'
  value: T
}

function cachePath(dir: string, kind: 'fast' | 'deep', key: string): string {
  return path.join(dir, kind, `${key}.json`)
}

function ensureCacheDir(dir: string, kind: 'fast' | 'deep'): string {
  const subDir = path.join(dir, kind)
  fs.mkdirSync(subDir, { recursive: true })
  return subDir
}

export function loadCachedTriage(key: string, dir: string): BugTriage | null {
  const file = cachePath(dir, 'fast', key)
  if (!fs.existsSync(file)) return null
  try {
    const entry = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheEntry<BugTriage>
    return entry.value
  } catch {
    return null
  }
}

export function saveCachedTriage(key: string, dir: string, value: BugTriage): void {
  ensureCacheDir(dir, 'fast')
  const entry: CacheEntry<BugTriage> = { cachedAt: new Date().toISOString(), key, kind: 'fast', value }
  try {
    fs.writeFileSync(cachePath(dir, 'fast', key), JSON.stringify(entry, null, 2))
  } catch {
    // No bloquear el análisis por un error de escritura
  }
}

export function loadCachedAnalysis(key: string, dir: string): BugAnalysis | null {
  const file = cachePath(dir, 'deep', key)
  if (!fs.existsSync(file)) return null
  try {
    const entry = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheEntry<BugAnalysis>
    return entry.value
  } catch {
    return null
  }
}

export function saveCachedAnalysis(key: string, dir: string, value: BugAnalysis): void {
  ensureCacheDir(dir, 'deep')
  const entry: CacheEntry<BugAnalysis> = { cachedAt: new Date().toISOString(), key, kind: 'deep', value }
  try {
    fs.writeFileSync(cachePath(dir, 'deep', key), JSON.stringify(entry, null, 2))
  } catch { /* swallow */ }
}

// ─── Stats / management ──────────────────────────────────────────────────────

export function getCacheStats(dir: string): { fast: number; deep: number; sizeKB: number } {
  let fast = 0, deep = 0, totalSize = 0
  for (const kind of ['fast', 'deep'] as const) {
    const subDir = path.join(dir, kind)
    if (!fs.existsSync(subDir)) continue
    try {
      const files = fs.readdirSync(subDir).filter((f) => f.endsWith('.json'))
      if (kind === 'fast') fast = files.length
      else                  deep = files.length
      for (const f of files) {
        try { totalSize += fs.statSync(path.join(subDir, f)).size } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return { fast, deep, sizeKB: Math.round(totalSize / 1024) }
}

export function clearCache(dir: string): void {
  for (const kind of ['fast', 'deep'] as const) {
    const subDir = path.join(dir, kind)
    if (fs.existsSync(subDir)) fs.rmSync(subDir, { recursive: true, force: true })
  }
}
