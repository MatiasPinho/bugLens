/**
 * agentTools.ts
 *
 * Tool definitions and execution for the agentic investigation loop.
 * Tools operate only within the configured repo directories (security).
 */

import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

// ─── Tool definitions (JSON Schema) ──────────────────────────────────────────

export interface ToolDef {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required: string[]
  }
}

export const TOOL_DEFINITIONS: ToolDef[] = [
  {
    name: 'grep',
    description:
      'Busca texto o patrones en los archivos del repositorio. ' +
      'Usá esto para encontrar componentes, servicios, funciones, rutas URL, nombres de pantalla, ' +
      'o cualquier string mencionado en el bug. Empezá siempre con esto.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Texto a buscar (case-insensitive). Puede ser nombre de componente, función, ruta, etc.',
        },
        path: {
          type: 'string',
          description: 'Subdirectorio donde limitar la búsqueda (relativo a la raíz del repo, opcional).',
        },
        file_ext: {
          type: 'string',
          description: 'Extensión de archivo a filtrar: "ts", "html", "css", "py", etc. (opcional).',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'read_file',
    description:
      'Lee el contenido de un archivo del repositorio con números de línea. ' +
      'Usá esto para leer un componente, servicio, template HTML, query SQL o configuración. ' +
      'Podés pedir secciones específicas con start_line/end_line.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path del archivo (relativo a la raíz del repo).',
        },
        start_line: {
          type: 'number',
          description: 'Primera línea a leer (1-indexed, opcional — default: inicio del archivo).',
        },
        end_line: {
          type: 'number',
          description: 'Última línea a leer (opcional — máximo 150 líneas por llamada).',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_directory',
    description:
      'Lista archivos y carpetas en una ruta del repositorio. ' +
      'Usá esto cuando no sabés exactamente dónde está un módulo o componente.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directorio a listar (relativo a la raíz del repo, vacío para la raíz).',
        },
      },
      required: [],
    },
  },
]

// ─── Security: resolve and validate paths ────────────────────────────────────

export function resolveRepoPath(inputPath: string, repoPaths: string[]): string | null {
  const cleaned = inputPath.replace(/^\/+/, '')

  for (const root of repoPaths) {
    // Try direct resolution and absolute path
    const direct = [
      path.resolve(root, cleaned),
      path.resolve(cleaned),
    ]
    for (const candidate of direct) {
      const norm = path.normalize(candidate)
      const withinRepo = repoPaths.some((r) => norm.startsWith(path.normalize(r)))
      if (withinRepo && fs.existsSync(norm)) return norm
    }

    // Try one level of subdirectory prefix — handles repos where sources live in
    // a subdirectory (e.g., the agent says "src/..." but the file is "source/src/...")
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
        const candidate = path.resolve(root, entry.name, cleaned)
        if (fs.existsSync(candidate)) return candidate
      }
    } catch { /* skip */ }
  }
  return null
}

// ─── Tool execution ───────────────────────────────────────────────────────────

function execGrep(
  pattern:  string,
  dir:      string | undefined,
  fileExt:  string | undefined,
  repoPaths: string[]
): string {
  const searchDirs = dir
    ? [resolveRepoPath(dir, repoPaths)].filter(Boolean) as string[]
    : repoPaths.filter(fs.existsSync)

  if (searchDirs.length === 0) return '[Error: directorio no encontrado o fuera del repo]'

  // Build include flags
  const DEFAULT_EXTS = ['ts', 'tsx', 'js', 'html', 'css', 'scss', 'py', 'java', 'go', 'sql', 'yaml', 'json']
  const exts = fileExt ? [fileExt.replace(/^\./, '')] : DEFAULT_EXTS
  const includeFlags = exts.map((e) => `--include="*.${e}"`).join(' ')

  const escaped = pattern.replace(/'/g, "'\\''").replace(/"/g, '\\"')
  const dirsStr = searchDirs.map((d) => `"${d}"`).join(' ')

  try {
    const cmd = `grep -r -n -i ${includeFlags} -m 6 '${escaped}' ${dirsStr} 2>/dev/null | head -60`
    const output = execSync(cmd, { timeout: 8_000, encoding: 'utf8' })
    if (!output.trim()) return `[Sin resultados para: "${pattern}"]`

    // Make paths relative to repo root for readability
    let result = output
    for (const r of repoPaths) result = result.replaceAll(r + path.sep, '')
    return result.trim()
  } catch {
    return `[Sin resultados para: "${pattern}"]`
  }
}

function execReadFile(
  filePath:  string,
  startLine: number | undefined,
  endLine:   number | undefined,
  repoPaths: string[]
): string {
  const resolved = resolveRepoPath(filePath, repoPaths)
  if (!resolved) return `[Archivo no encontrado: ${filePath}]`

  try {
    const all   = fs.readFileSync(resolved, 'utf8').split('\n')
    const start = Math.max(0, (startLine ?? 1) - 1)
    const end   = Math.min(start + 80, endLine ? endLine : start + 80, all.length)

    const relPath = repoPaths.reduce((p, r) => p.replace(r + path.sep, ''), resolved)
    const header  = `// ${relPath} (líneas ${start + 1}–${end} de ${all.length})\n`
    const body    = all.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n')
    return header + body
  } catch {
    return `[Error al leer: ${filePath}]`
  }
}

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'coverage', '.venv', 'vendor'])

function execListDir(dirPath: string | undefined, repoPaths: string[]): string {
  const dirs = dirPath
    ? [resolveRepoPath(dirPath, repoPaths)].filter(Boolean) as string[]
    : repoPaths.filter(fs.existsSync)

  if (dirs.length === 0) return '[Directorio no encontrado]'

  const lines: string[] = []
  for (const dir of dirs) {
    try {
      const relPath = repoPaths.reduce((p, r) => p.replace(r, ''), dir) || '/'
      lines.push(`📁 ${relPath}`)
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => !IGNORE_DIRS.has(e.name))
        .sort((a, b) => (a.isDirectory() ? -1 : 1) - (b.isDirectory() ? -1 : 1) || a.name.localeCompare(b.name))
      for (const e of entries) {
        lines.push(`  ${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
      }
    } catch { /* skip */ }
  }
  return lines.join('\n') || '[Directorio vacío]'
}

export function executeTool(
  name:      string,
  args:      Record<string, unknown>,
  repoPaths: string[]
): string {
  switch (name) {
    case 'grep':
      return execGrep(
        String(args['pattern'] ?? ''),
        args['path'] ? String(args['path']) : undefined,
        args['file_ext'] ? String(args['file_ext']) : undefined,
        repoPaths
      )
    case 'read_file':
      return execReadFile(
        String(args['path'] ?? ''),
        args['start_line'] ? Number(args['start_line']) : undefined,
        args['end_line']   ? Number(args['end_line'])   : undefined,
        repoPaths
      )
    case 'list_directory':
      return execListDir(
        args['path'] ? String(args['path']) : undefined,
        repoPaths
      )
    default:
      return `[Herramienta desconocida: ${name}]`
  }
}
