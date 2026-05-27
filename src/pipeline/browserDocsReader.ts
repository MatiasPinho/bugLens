/**
 * browserDocsReader.ts
 *
 * Lee Google Docs usando la sesión del navegador del usuario.
 * No requiere OAuth, no requiere credenciales de Google Cloud,
 * no requiere aprobación del admin de la empresa.
 *
 * Flujo:
 *   1. Primera vez: abre una ventana de Chromium visible, el usuario hace login normal
 *   2. El perfil del browser (con la sesión) queda guardado en disco
 *   3. Para leer docs: lanza Chromium headless con ese mismo perfil y navega
 *      directamente a la URL de exportación — Google lo ve como Chrome real
 *
 * Por qué no usar fetch() con cookies:
 *   Google verifica el fingerprint TLS del cliente. Node.js fetch no pasa ese
 *   control aunque tenga cookies válidas. Usando Chromium headless el fingerprint
 *   es idéntico al de un browser real y Google acepta la request.
 */

import * as fs from 'fs'
import * as path from 'path'
import { GoogleDocContent, DocImage } from '../types/index.js'

const COOKIE_FILE_NAME  = 'google-session-cookies.json'
const PROFILE_DIR_NAME  = 'browser-profile'
const LOGIN_TIMEOUT_MS  = 5 * 60 * 1000   // 5 minutos para que el usuario haga login
const POLL_INTERVAL_MS  = 2000

// URLs de exportación directa de Google Docs
const EXPORT_URLS: Record<string, string> = {
  document:     'https://docs.google.com/document/d/{id}/export?format=txt',
  spreadsheets: 'https://docs.google.com/spreadsheets/d/{id}/export?format=csv',
  presentation: 'https://docs.google.com/presentation/d/{id}/export/txt',
}

const SESSION_COOKIE_NAMES = ['SAPISID', '__Secure-1PSID', 'SID', '__Secure-3PSID']

// ─── URL parsing ──────────────────────────────────────────────────────────────

function extractDocInfo(url: string): { id: string; type: string } | null {
  const docsMatch = url.match(
    /docs\.google\.com\/(document|spreadsheets|presentation|forms)\/d\/([a-zA-Z0-9_-]+)/
  )
  if (docsMatch) return { type: docsMatch[1], id: docsMatch[2] }

  const driveMatch = url.match(
    /drive\.google\.com\/(?:file\/d\/([a-zA-Z0-9_-]+)|open\?id=([a-zA-Z0-9_-]+))/
  )
  if (driveMatch) return { type: 'drive', id: driveMatch[1] ?? driveMatch[2] }

  return null
}

// ─── Cookie types ─────────────────────────────────────────────────────────────

interface SavedCookie {
  name: string
  value: string
  domain: string
  path: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
}

// ─── Playwright import helper ─────────────────────────────────────────────────

async function getChromium() {
  const mod = await (new Function('m', 'return import(m)')('playwright-core') as Promise<typeof import('playwright-core')>)
  return mod.chromium
}

// ─── BrowserDocsReader ────────────────────────────────────────────────────────

export class BrowserDocsReader {
  private cookiePath:   string
  private profilePath:  string
  // Contexto headless reutilizable durante una sesión de lectura
  // Se abre la primera vez que se lee un doc y se cierra con closeContext()
  private _context: import('playwright-core').BrowserContext | null = null

  constructor(private dataDir: string) {
    this.cookiePath  = path.join(dataDir, COOKIE_FILE_NAME)
    this.profilePath = path.join(dataDir, PROFILE_DIR_NAME)
  }

  // ─── Session management ───────────────────────────────────────────────────

  isAuthenticated(): boolean {
    // Chequeo rápido sin abrir el browser:
    // El perfil existe + el archivo de cookies tiene sesión válida
    if (!fs.existsSync(this.profilePath)) return false
    if (!fs.existsSync(this.cookiePath))  return false
    try {
      const cookies: SavedCookie[] = JSON.parse(fs.readFileSync(this.cookiePath, 'utf8'))
      return cookies.some(
        (c) => c.domain.includes('google.com') && SESSION_COOKIE_NAMES.includes(c.name)
      )
    } catch {
      return false
    }
  }

  /**
   * Abre una ventana de Chromium visible para que el usuario haga login en Google.
   * Cuando detecta las cookies de sesión, guarda el estado y cierra la ventana.
   */
  async startLoginFlow(): Promise<void> {
    const chromium    = await getChromium()
    const chromiumPath = findChromiumPath()

    const context = await chromium.launchPersistentContext(
      this.profilePath,
      {
        executablePath: chromiumPath || undefined,
        headless: false,
        args: [
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-blink-features=AutomationControlled',
        ],
        viewport: { width: 1100, height: 750 },
      }
    )

    // Limpiar cookies previas para forzar login activo
    await context.clearCookies()

    const page = context.pages()[0] ?? await context.newPage()
    await page.goto('https://accounts.google.com/signin')
    console.log('[browserDocs] Ventana de login abierta — esperando autenticación...')

    // Polling de cookies — más robusto que waitForURL para SSO corporativo
    const startedAt = Date.now()
    let authenticated = false

    while (Date.now() - startedAt < LOGIN_TIMEOUT_MS) {
      const cookies = await context.cookies()
      if (cookies.some((c) => c.domain.includes('google.com') && SESSION_COOKIE_NAMES.includes(c.name))) {
        authenticated = true
        break
      }
      await new Promise<void>((res) => setTimeout(res, POLL_INTERVAL_MS))
    }

    if (!authenticated) {
      await context.close()
      throw new Error('Timeout: el usuario no completó el login en 5 minutos')
    }

    // Navegar a Drive para que Google setee cookies adicionales de Workspace
    try {
      await page.goto('https://drive.google.com', { waitUntil: 'load', timeout: 15_000 })
      await new Promise<void>((res) => setTimeout(res, 2000))
    } catch {
      console.log('[browserDocs] Navegación a Drive omitida, usando cookies existentes')
    }

    // Guardar cookies en disco (se usan para isAuthenticated() en sesiones futuras)
    const allCookies   = await context.cookies()
    const googleCookies = allCookies.filter((c) => c.domain.includes('google.com'))
    fs.mkdirSync(this.dataDir, { recursive: true })
    fs.writeFileSync(this.cookiePath, JSON.stringify(googleCookies, null, 2))

    await context.close()
    console.log(`[browserDocs] Login completado — ${googleCookies.length} cookies guardadas`)
  }

  /** Cierra el contexto headless si estaba abierto (llamar al final de un análisis). */
  async closeContext(): Promise<void> {
    if (this._context) {
      await this._context.close().catch(() => {})
      this._context = null
    }
  }

  /** Borra la sesión completamente (cookies + perfil del browser). */
  revokeSession(): void {
    // Cerrar el contexto headless si está abierto
    void this.closeContext()

    if (fs.existsSync(this.cookiePath)) fs.unlinkSync(this.cookiePath)

    // Borrar el perfil — si no lo borramos, el próximo login es instantáneo
    // (Chromium restaura la sesión guardada sin que el usuario haga nada)
    if (fs.existsSync(this.profilePath)) {
      fs.rmSync(this.profilePath, { recursive: true, force: true })
    }
  }

  // ─── Headless context ─────────────────────────────────────────────────────

  /**
   * Obtiene (o crea) el contexto headless reutilizable.
   * Usa el mismo perfil del login → Google lo acepta como Chrome real.
   */
  private async getContext(): Promise<import('playwright-core').BrowserContext> {
    if (this._context) return this._context

    const chromium     = await getChromium()
    const chromiumPath = findChromiumPath()

    this._context = await chromium.launchPersistentContext(
      this.profilePath,
      {
        executablePath: chromiumPath || undefined,
        headless: true,   // sin ventana — el usuario ya está logueado en el perfil
        args: [
          '--no-sandbox',
          '--no-first-run',
          '--disable-blink-features=AutomationControlled',
        ],
      }
    )
    return this._context
  }

  // ─── Document reading ─────────────────────────────────────────────────────

  async readDocument(url: string): Promise<GoogleDocContent> {
    const info = extractDocInfo(url)
    if (!info) {
      return { url, title: '', text: '', accessible: false, error: 'URL no reconocida' }
    }

    try {
      if (info.type === 'drive') {
        return await this.readDriveFile(url, info.id)
      }
      return await this.readGoogleDoc(url, info.id, info.type)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { url, title: '', text: '', accessible: false, error: message }
    }
  }

  private async readGoogleDoc(url: string, id: string, type: string): Promise<GoogleDocContent> {
    // Spreadsheets y presentaciones: exportar como CSV/TXT (sin imágenes relevantes)
    if (type !== 'document') {
      const template  = EXPORT_URLS[type] ?? EXPORT_URLS['document']
      const exportUrl = template.replace('{id}', id)
      const context   = await this.getContext()
      const response  = await context.request.get(exportUrl, { maxRedirects: 5, timeout: 30_000 })
      if (!response.ok()) throw new Error(`HTTP ${response.status()} al descargar el documento`)
      if (response.url().includes('accounts.google.com')) throw new Error('Sesión expirada — volvé a hacer login')
      const text  = await response.text()
      const lines = text.split('\n').filter((l) => l.trim())
      return { url, title: lines[0]?.slice(0, 100) ?? 'Sin título', text: text.trim(), accessible: true }
    }

    // Google Docs: exportar como HTML para obtener texto limpio + imágenes
    const exportUrl = `https://docs.google.com/document/d/${id}/export?format=html`
    const context   = await this.getContext()

    const htmlResponse = await context.request.get(exportUrl, { maxRedirects: 5, timeout: 30_000 })
    if (htmlResponse.status() === 401 || htmlResponse.status() === 403) {
      throw new Error('Sin acceso al documento — verificá que tenés permiso o volvé a hacer login')
    }
    if (!htmlResponse.ok()) throw new Error(`HTTP ${htmlResponse.status()} al exportar el documento`)
    if (htmlResponse.url().includes('accounts.google.com')) throw new Error('Sesión expirada — volvé a hacer login')

    const html = await htmlResponse.text()

    // Parsear HTML con regex en Node.js — sin página, sin problemas de tipos DOM
    const text      = htmlToText(html)
    const imageSrcs = extractImageSrcs(html)

    // Descargar imágenes con el contexto autenticado (max 8, max 2 MB c/u)
    const MAX_IMAGES   = 8
    const MAX_BYTES    = 2 * 1024 * 1024
    const MIN_BYTES    = 2 * 1024   // ignorar íconos < 2 KB
    const images: DocImage[] = []

    for (const { src, alt } of imageSrcs.slice(0, MAX_IMAGES * 2)) {
      if (images.length >= MAX_IMAGES) break
      try {
        if (src.startsWith('data:image/')) {
          // Imagen inline base64 — Google Docs HTML export las incluye directamente
          const commaIdx = src.indexOf(',')
          if (commaIdx === -1) continue
          const header   = src.slice(0, commaIdx)            // "data:image/png;base64"
          const b64      = src.slice(commaIdx + 1)           // datos base64 puros
          const mimeType = header.replace('data:', '').replace(';base64', '').trim()
          if (!mimeType.startsWith('image/') || !b64) continue
          // Verificar tamaño aproximado (cada char base64 ≈ 0.75 bytes)
          const approxBytes = Math.round(b64.length * 0.75)
          if (approxBytes < MIN_BYTES || approxBytes > MAX_BYTES) continue
          images.push({ data: b64, mimeType, alt })
        } else {
          // URL externa — descargar con Chromium autenticado
          const imgRes = await context.request.get(src, { timeout: 15_000 })
          if (!imgRes.ok()) continue
          const buf      = await imgRes.body()
          if (buf.length < MIN_BYTES || buf.length > MAX_BYTES) continue
          const ct       = imgRes.headers()['content-type'] ?? ''
          const mimeType = ct.split(';')[0].trim()
          if (!mimeType.startsWith('image/')) continue
          images.push({ data: buf.toString('base64'), mimeType, alt })
        }
      } catch {
        // Ignorar imágenes que fallen
      }
    }

    const lines = text.split('\n').filter((l) => l.trim())
    const title = lines[0]?.slice(0, 100) ?? 'Sin título'

    return { url, title, text: text.trim(), accessible: true, images }
  }

  private async readDriveFile(url: string, id: string): Promise<GoogleDocContent> {
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${id}`

    const context  = await this.getContext()
    const response = await context.request.get(downloadUrl, { maxRedirects: 5, timeout: 30_000 })

    if (!response.ok()) {
      throw new Error(`No se pudo descargar el archivo (HTTP ${response.status()})`)
    }

    const contentType = response.headers()['content-type'] ?? ''
    if (!contentType.includes('text') && !contentType.includes('json')) {
      return {
        url,
        title: `Archivo Drive (${id})`,
        text:  `[Archivo binario — tipo: ${contentType}]`,
        accessible: true,
      }
    }

    const text = await response.text()
    return { url, title: `Archivo Drive (${id})`, text: text.trim(), accessible: true }
  }

  /** Lee varios documentos secuencialmente. Nunca lanza — errores van en el resultado. */
  async readDocuments(urls: string[]): Promise<GoogleDocContent[]> {
    const results: GoogleDocContent[] = []
    for (const u of urls) {
      results.push(await this.readDocument(u))
    }
    return results
  }
}

// ─── HTML parsing helpers ─────────────────────────────────────────────────────

/** Convierte HTML a texto plano eliminando etiquetas y decodificando entidades. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\r?\n[ \t]*\r?\n/g, '\n')
    .trim()
}

/** Extrae src + alt de todas las etiquetas <img> del HTML. */
function extractImageSrcs(html: string): Array<{ src: string; alt: string }> {
  const results: Array<{ src: string; alt: string }> = []
  const imgRe  = /<img[^>]+>/gi
  const srcRe  = /\bsrc="([^"]+)"/i
  const altRe  = /\balt="([^"]*)"/i

  let m: RegExpExecArray | null
  while ((m = imgRe.exec(html)) !== null) {
    const tag      = m[0]
    const srcMatch = srcRe.exec(tag)
    if (!srcMatch) continue
    const src = srcMatch[1]
    // Aceptar URLs http/https y data URIs base64 (Google Docs export embebe las imágenes inline)
    if (!src.startsWith('http') && !src.startsWith('data:image/')) continue
    const altMatch = altRe.exec(tag)
    results.push({ src, alt: altMatch ? altMatch[1] : '' })
  }
  return results
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

function findChromiumPath(): string | null {
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/brave-browser',
    '/snap/bin/chromium',
    '/opt/google/chrome/chrome',
    process.env['CHROME_PATH'],
    process.env['CHROMIUM_PATH'],
  ]
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}
