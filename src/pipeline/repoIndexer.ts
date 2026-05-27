/**
 * repoIndexer.ts
 *
 * Índice de embeddings local, sin servidor externo.
 * Usa @xenova/transformers para generar embeddings en proceso
 * y los persiste en dos archivos en disco:
 *   - {indexPath}/metadata.json  → array de { filePath, startLine, endLine, content }
 *   - {indexPath}/embeddings.bin → Float32Array concatenada (dim × chunks)
 *
 * En la primera ejecución descarga el modelo desde HuggingFace (~23 MB).
 * Las siguientes ejecuciones usan el caché local.
 */

import * as fs from 'fs'
import * as path from 'path'
import { CodeFragment } from '../types/index.js'

// ─── Config ──────────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'
const EMBEDDING_DIM   = 384
const CHUNK_SIZE      = 60
const CHUNK_OVERLAP   = 10
const TOP_K           = 5
const BATCH_SIZE      = 32   // chunks por batch al indexar

const INDEXABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts',
  '.vue', '.svelte',
  '.py', '.java', '.kt', '.go', '.rs', '.rb', '.php',
  '.css', '.scss', '.sass', '.less',
  '.html', '.xml', '.json', '.yaml', '.yml',
  '.sql', '.graphql', '.gql',
  '.sh', '.bash', '.md',
])

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.nyc_output', 'vendor', '__pycache__', '.venv',
  'venv', 'target', '.gradle', '.idea', '.vscode', 'out',
])

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChunkMeta {
  filePath: string
  startLine: number
  endLine: number
  content: string
}

type ProgressCallback = (msg: string, processed: number, total: number) => void

// ─── Lazy pipeline ────────────────────────────────────────────────────────────

let _embedder: ((texts: string[], opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>) | null = null

async function getEmbedder() {
  if (_embedder) return _embedder

  // @xenova/transformers es ESM-only. TypeScript con module:CommonJS convierte
  // import() dinámico a require(), que no puede cargar ESM.
  // La Function() trick evita esa transformación y usa el import() nativo de Node.
  const { pipeline, env } = await (new Function('m', 'return import(m)')('@xenova/transformers') as Promise<typeof import('@xenova/transformers')>)

  // Use the app's userData for model cache (set by caller if needed)
  if (process.env['XDG_CACHE_HOME']) {
    env.cacheDir = path.join(process.env['XDG_CACHE_HOME'], 'bug-analyzer', 'models')
  }

  const pipe = await pipeline('feature-extraction', EMBEDDING_MODEL)

  // Wrap so TS is happy with the dynamic result
  _embedder = async (texts: string[], opts: { pooling: string; normalize: boolean }) => {
    const result = await (pipe as (input: string | string[], options: unknown) => Promise<{ data: Float32Array }>)(texts, opts)
    return result
  }
  return _embedder
}

async function embed(texts: string[]): Promise<Float32Array[]> {
  const embedder = await getEmbedder()
  const results: Float32Array[] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const output = await embedder(batch, { pooling: 'mean', normalize: true })

    // output.data is a flat Float32Array of shape [batchSize * EMBEDDING_DIM]
    for (let j = 0; j < batch.length; j++) {
      const start = j * EMBEDDING_DIM
      results.push(output.data.slice(start, start + EMBEDDING_DIM) as Float32Array)
    }
  }
  return results
}

// ─── Index paths ──────────────────────────────────────────────────────────────

function metaPath(indexPath: string)  { return path.join(indexPath, 'metadata.json') }
function binPath(indexPath: string)   { return path.join(indexPath, 'embeddings.bin') }

// ─── RepoIndexer ─────────────────────────────────────────────────────────────

export class RepoIndexer {
  // In-memory cache: loaded once per process, reused for all searches in a run
  private _cache: { metas: ChunkMeta[]; embeddings: Float32Array } | null = null

  constructor(private indexPath: string) {}

  /** Returns true if a saved index exists on disk. */
  async hasIndex(): Promise<boolean> {
    return fs.existsSync(metaPath(this.indexPath)) && fs.existsSync(binPath(this.indexPath))
  }

  /** Indexes the given repo paths, replacing any existing index. */
  async indexRepos(repoPaths: string[], onProgress?: ProgressCallback): Promise<void> {
    // Collect all source files
    const allFiles: string[] = []
    for (const p of repoPaths) {
      if (p && fs.existsSync(p)) collectFiles(p, allFiles)
    }

    onProgress?.(`Archivos encontrados: ${allFiles.length}`, 0, allFiles.length)

    // Build chunks
    const metas: ChunkMeta[] = []
    let processed = 0

    for (const filePath of allFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf8')
        metas.push(...chunkFile(filePath, content))
      } catch { /* skip unreadable */ }

      processed++
      if (processed % 20 === 0 || processed === allFiles.length) {
        onProgress?.(`Leyendo archivos: ${path.basename(filePath)}`, processed, allFiles.length)
      }
    }

    onProgress?.(`Generando embeddings para ${metas.length} fragmentos...`, 0, metas.length)

    // Generate embeddings in batches
    const texts = metas.map((m) => m.content)
    const allEmbeddings: Float32Array[] = []

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE)
      const embedder = await getEmbedder()
      const output = await embedder(batch, { pooling: 'mean', normalize: true })

      for (let j = 0; j < batch.length; j++) {
        const start = j * EMBEDDING_DIM
        allEmbeddings.push(output.data.slice(start, start + EMBEDDING_DIM) as Float32Array)
      }

      onProgress?.(`Embeddings: ${Math.min(i + BATCH_SIZE, texts.length)} / ${texts.length}`, i + BATCH_SIZE, texts.length)
    }

    // Persist to disk
    fs.mkdirSync(this.indexPath, { recursive: true })

    // metadata.json
    fs.writeFileSync(metaPath(this.indexPath), JSON.stringify(metas))

    // embeddings.bin — concatenate all Float32Arrays
    const total = allEmbeddings.length * EMBEDDING_DIM
    const flat = new Float32Array(total)
    for (let i = 0; i < allEmbeddings.length; i++) {
      flat.set(allEmbeddings[i], i * EMBEDDING_DIM)
    }
    fs.writeFileSync(binPath(this.indexPath), Buffer.from(flat.buffer))

    onProgress?.('Índice guardado en disco', metas.length, metas.length)
  }

  /** Loads the index into memory (call once before parallel searches). No-op if already loaded. */
  async warmUp(): Promise<void> {
    if (this._cache) return
    if (!(await this.hasIndex())) return
    const metaRaw = fs.readFileSync(metaPath(this.indexPath), 'utf8')
    const metas: ChunkMeta[] = JSON.parse(metaRaw)
    const binRaw = fs.readFileSync(binPath(this.indexPath))
    const embeddings = new Float32Array(binRaw.buffer.slice(binRaw.byteOffset, binRaw.byteOffset + binRaw.byteLength))
    this._cache = { metas, embeddings }
  }

  /** Invalidates the in-memory cache (call after re-indexing). */
  clearCache(): void {
    this._cache = null
  }

  /** Searches for the top-k most relevant code fragments. */
  async search(query: string, topK: number = TOP_K): Promise<CodeFragment[]> {
    if (!(await this.hasIndex())) return []

    // Use in-memory cache if available, otherwise load from disk
    let metas: ChunkMeta[]
    let allEmbeddings: Float32Array

    if (this._cache) {
      metas = this._cache.metas
      allEmbeddings = this._cache.embeddings
    } else {
      const metaRaw = fs.readFileSync(metaPath(this.indexPath), 'utf8')
      metas = JSON.parse(metaRaw)
      const binRaw = fs.readFileSync(binPath(this.indexPath))
      allEmbeddings = new Float32Array(binRaw.buffer, binRaw.byteOffset, binRaw.byteLength / 4)
    }

    // Embed query
    const [queryVec] = await embed([query])

    // Cosine similarity (embeddings are already normalized → dot product = cosine sim)
    const scores: Array<{ idx: number; score: number }> = []
    for (let i = 0; i < metas.length; i++) {
      const offset = i * EMBEDDING_DIM
      let dot = 0
      for (let d = 0; d < EMBEDDING_DIM; d++) {
        dot += queryVec[d] * allEmbeddings[offset + d]
      }
      scores.push({ idx: i, score: dot })
    }

    scores.sort((a, b) => b.score - a.score)
    const top = scores.slice(0, topK)

    return top.map(({ idx, score }) => ({
      filePath: metas[idx].filePath,
      startLine: metas[idx].startLine,
      endLine: metas[idx].endLine,
      content: metas[idx].content,
      score,
    }))
  }

  /** Deletes the index from disk and clears the in-memory cache. */
  async deleteIndex(): Promise<void> {
    this._cache = null
    for (const f of [metaPath(this.indexPath), binPath(this.indexPath)]) {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
  }
}

// ─── File helpers ─────────────────────────────────────────────────────────────

function collectFiles(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(full, out)
    } else if (entry.isFile() && INDEXABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
}

function chunkFile(filePath: string, content: string): ChunkMeta[] {
  const lines = content.split('\n')
  const chunks: ChunkMeta[] = []
  let start = 0

  while (start < lines.length) {
    const end = Math.min(start + CHUNK_SIZE - 1, lines.length - 1)
    const text = lines.slice(start, end + 1).join('\n').trim()

    if (text.length > 0) {
      chunks.push({
        filePath,
        startLine: start + 1,
        endLine: end + 1,
        content: `// File: ${filePath} (lines ${start + 1}-${end + 1})\n${text}`,
      })
    }

    if (end >= lines.length - 1) break
    start = end - CHUNK_OVERLAP + 1
  }
  return chunks
}
