import * as XLSX from 'xlsx'
import { RawBug } from '../types/index.js'

// Regex para detectar URLs de Google Docs o Google Drive en cualquier celda
const GOOGLE_DOC_REGEX =
  /https?:\/\/docs\.google\.com\/(document|spreadsheets|presentation|forms)\/d\/[a-zA-Z0-9_-]+[^\s"]*/g

const GOOGLE_DRIVE_REGEX =
  /https?:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=)[a-zA-Z0-9_-]+[^\s"]*/g

/**
 * Extrae todos los Google Doc/Drive links de un string.
 */
function extractGoogleLinks(text: string): string[] {
  const links: string[] = []
  const docMatches = text.matchAll(GOOGLE_DOC_REGEX)
  const driveMatches = text.matchAll(GOOGLE_DRIVE_REGEX)
  for (const m of docMatches) links.push(m[0])
  for (const m of driveMatches) links.push(m[0])
  return [...new Set(links)] // dedup
}

/**
 * Intenta mapear cabeceras del Excel a campos conocidos del bug.
 * Es case-insensitive y acepta variaciones comunes en español/inglés.
 */
function mapHeader(header: string): string | null {
  const h = header.toLowerCase().trim()
  if (/t[ií]tulo|title|summary|resumen/.test(h)) return 'title'
  if (/descripci[oó]n|description|detail/.test(h)) return 'description'
  if (/paso|step/.test(h)) return 'stepsToReproduce'
  if (/esperado|expected/.test(h)) return 'expectedResult'
  if (/actual|resultado actual|real result/.test(h)) return 'actualResult'
  if (/entorno|environment|env/.test(h)) return 'environment'
  if (/reporter|reportado|reported by/.test(h)) return 'reporter'
  if (/asignado|assignee|assigned/.test(h)) return 'assignee'
  if (/estado|status/.test(h)) return 'status'
  if (/prioridad|priority/.test(h)) return 'priority'
  return null
}

/**
 * Parsea un archivo Excel y devuelve la lista de bugs crudos.
 * Toma la primera hoja con datos.
 */
export function readExcel(filePath: string): RawBug[] {
  const isCsv = filePath.toLowerCase().endsWith('.csv')
  const workbook = XLSX.readFile(filePath, {
    type: 'file',
    cellFormula: false,
    // CSV: forzar UTF-8 para evitar que Ã³ aparezca en lugar de ó
    codepage: isCsv ? 65001 : undefined,
  })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('El Excel no tiene hojas.')

  const sheet = workbook.Sheets[sheetName]
  const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: false, // fuerza string en todas las celdas
  })

  if (rows.length === 0) throw new Error('La primera hoja del Excel está vacía.')

  // Detectar filas que son encabezados repetidos (ej: fila con Nombre=Nombre, Vista=Vista)
  const isRepeatedHeader = (row: Record<string, string>): boolean => {
    const entries = Object.entries(row).filter(([, v]) => v.trim() !== '')
    if (entries.length === 0) return false
    const matching = entries.filter(([k, v]) => k.trim().toLowerCase() === v.trim().toLowerCase())
    return matching.length >= Math.ceil(entries.length * 0.6)
  }

  const validRows = rows.filter((row) => !isRepeatedHeader(row))

  return validRows.map((row, index) => {
    const rawRow: Record<string, string> = {}
    const mapped: Partial<RawBug> = {}
    let googleDocLinks: string[] = []

    for (const [header, value] of Object.entries(row)) {
      const cellValue = String(value ?? '').trim()
      rawRow[header] = cellValue

      const field = mapHeader(header)
      if (field) {
        ;(mapped as Record<string, string>)[field] = cellValue
      }

      // Busca links en TODAS las celdas
      googleDocLinks.push(...extractGoogleLinks(cellValue))
    }

    googleDocLinks = [...new Set(googleDocLinks)]

    // Genera un ID estable para el bug
    const id = `bug-${String(index + 1).padStart(4, '0')}`

    // Fallback para el título si no hay columna mapeada
    const title =
      mapped.title ||
      rawRow['Título'] ||
      rawRow['Title'] ||
      rawRow['Summary'] ||
      rawRow[Object.keys(rawRow)[0]] ||
      `Bug #${index + 1}`

    return {
      id,
      rowIndex: index + 1,
      title,
      description: mapped.description || '',
      stepsToReproduce: mapped.stepsToReproduce,
      expectedResult: mapped.expectedResult,
      actualResult: mapped.actualResult,
      environment: mapped.environment,
      reporter: mapped.reporter,
      assignee: mapped.assignee,
      status: mapped.status,
      priority: mapped.priority,
      rawRow,
      googleDocLinks,
    } satisfies RawBug
  })
}

/**
 * Escribe el Excel enriquecido con los resultados del análisis.
 */
export function writeEnrichedExcel(
  outputPath: string,
  originalPath: string,
  results: Array<{
    rowIndex: number
    category: string
    severity: string
    difficulty: string
    confidence: number
    probableCause: string
    relatedFiles: string[]
    needsMoreInfo: boolean
    summary: string
    error?: string
  }>
): void {
  const workbook = XLSX.readFile(originalPath, { type: 'file', cellFormula: false })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]

  // Encuentra la columna final
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1')
  const lastCol = range.e.c

  const newHeaders = [
    'Categoría LLM',
    'Severidad LLM',
    'Dificultad LLM',
    'Confianza',
    'Causa Probable',
    'Archivos Relacionados',
    'Necesita Más Info',
    'Resumen LLM',
    'Error Análisis',
  ]

  // Escribe cabeceras en la fila 1
  newHeaders.forEach((header, i) => {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: lastCol + 1 + i })
    sheet[cellRef] = { v: header, t: 's' }
  })

  // Actualiza el rango
  range.e.c = lastCol + newHeaders.length
  sheet['!ref'] = XLSX.utils.encode_range(range)

  // Escribe los resultados por fila
  for (const result of results) {
    const r = result.rowIndex // rowIndex ya es 1-based para la fila de datos (fila 2 del sheet = index 1)
    const vals = [
      result.category,
      result.severity,
      result.difficulty,
      result.confidence.toFixed(2),
      result.probableCause,
      result.relatedFiles.join(' | '),
      result.needsMoreInfo ? 'Sí' : 'No',
      result.summary,
      result.error ?? '',
    ]
    vals.forEach((val, i) => {
      const cellRef = XLSX.utils.encode_cell({ r, c: lastCol + 1 + i })
      sheet[cellRef] = { v: val, t: 's' }
    })
  }

  XLSX.writeFile(workbook, outputPath)
}
