import { google, docs_v1 } from 'googleapis'
import { OAuth2Client } from 'google-auth-library'
import * as fs from 'fs'
import * as path from 'path'
import * as http from 'http'
import * as url from 'url'
import { GoogleDocContent } from '../types/index.js'

const SCOPES = [
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
]

// Extracts document ID from a Google Docs/Drive URL
function extractDocId(docUrl: string): { id: string; type: 'doc' | 'drive' } | null {
  // Google Docs: https://docs.google.com/document/d/<ID>/...
  const docsMatch = docUrl.match(
    /docs\.google\.com\/(?:document|spreadsheets|presentation|forms)\/d\/([a-zA-Z0-9_-]+)/
  )
  if (docsMatch) return { id: docsMatch[1], type: 'doc' }

  // Google Drive: https://drive.google.com/file/d/<ID>/... or ?id=<ID>
  const driveMatch = docUrl.match(/drive\.google\.com\/(?:file\/d\/([a-zA-Z0-9_-]+)|open\?id=([a-zA-Z0-9_-]+))/)
  if (driveMatch) return { id: driveMatch[1] ?? driveMatch[2], type: 'drive' }

  return null
}

export class GoogleDocsReader {
  private oauth2Client: OAuth2Client
  private tokenPath: string

  constructor(clientId: string, clientSecret: string, tokenPath: string) {
    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'http://localhost:3000/oauth2callback'
    )
    this.tokenPath = tokenPath
  }

  /**
   * Returns true if there's a valid saved token.
   */
  isAuthenticated(): boolean {
    if (!fs.existsSync(this.tokenPath)) return false
    try {
      const token = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8'))
      this.oauth2Client.setCredentials(token)
      return true
    } catch {
      return false
    }
  }

  /**
   * Launches a local HTTP server to handle the OAuth2 callback,
   * then opens the browser for the user to authorize.
   * Returns the authorization URL for the renderer to open.
   */
  getAuthUrl(): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    })
  }

  /**
   * Starts a local server on port 3000 to receive the OAuth callback.
   * Resolves with the authenticated client when done.
   */
  async waitForCallback(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          const parsed = url.parse(req.url ?? '', true)
          if (parsed.pathname !== '/oauth2callback') return

          const code = parsed.query['code']
          if (!code || typeof code !== 'string') {
            res.end('Error: no se recibió el código de autorización.')
            reject(new Error('No authorization code received'))
            return
          }

          const { tokens } = await this.oauth2Client.getToken(code)
          this.oauth2Client.setCredentials(tokens)

          // Persist token
          fs.mkdirSync(path.dirname(this.tokenPath), { recursive: true })
          fs.writeFileSync(this.tokenPath, JSON.stringify(tokens, null, 2))

          res.end('<html><body><h2>¡Autorizado! Podés cerrar esta ventana.</h2></body></html>')
          server.close()
          resolve()
        } catch (err) {
          res.end('Error durante la autorización.')
          server.close()
          reject(err)
        }
      })

      server.listen(3000, () => {
        console.log('Waiting for Google OAuth callback on http://localhost:3000/oauth2callback')
      })

      server.on('error', reject)

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close()
        reject(new Error('OAuth timeout: el usuario no autorizó en 5 minutos'))
      }, 5 * 60 * 1000)
    })
  }

  /**
   * Revokes and deletes the saved token.
   */
  async revokeAuth(): Promise<void> {
    if (fs.existsSync(this.tokenPath)) {
      try {
        await this.oauth2Client.revokeCredentials()
      } catch {
        // ignore revoke errors
      }
      fs.unlinkSync(this.tokenPath)
    }
  }

  /**
   * Reads the content of a Google Doc by URL.
   */
  async readDocument(docUrl: string): Promise<GoogleDocContent> {
    const parsed = extractDocId(docUrl)
    if (!parsed) {
      return {
        url: docUrl,
        title: '',
        text: '',
        accessible: false,
        error: 'URL no reconocida como Google Doc o Drive',
      }
    }

    try {
      if (parsed.type === 'doc') {
        return await this.readGoogleDoc(docUrl, parsed.id)
      } else {
        return await this.readDriveFile(docUrl, parsed.id)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        url: docUrl,
        title: '',
        text: '',
        accessible: false,
        error: `Error al leer el documento: ${message}`,
      }
    }
  }

  private async readGoogleDoc(docUrl: string, docId: string): Promise<GoogleDocContent> {
    const docs = google.docs({ version: 'v1', auth: this.oauth2Client })
    const response = await docs.documents.get({ documentId: docId })
    const doc = response.data

    const title = doc.title ?? 'Sin título'
    const text = extractTextFromDoc(doc)

    return { url: docUrl, title, text, accessible: true }
  }

  private async readDriveFile(docUrl: string, fileId: string): Promise<GoogleDocContent> {
    const drive = google.drive({ version: 'v3', auth: this.oauth2Client })

    // Get file metadata to know the MIME type
    const meta = await drive.files.get({ fileId, fields: 'name,mimeType' })
    const mimeType = meta.data.mimeType ?? ''
    const title = meta.data.name ?? 'Sin título'

    let text = ''

    if (mimeType === 'application/vnd.google-apps.document') {
      // Export as plain text
      const exported = await drive.files.export({ fileId, mimeType: 'text/plain' }, { responseType: 'text' })
      text = typeof exported.data === 'string' ? exported.data : ''
    } else if (mimeType.startsWith('text/')) {
      const downloaded = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' })
      text = typeof downloaded.data === 'string' ? downloaded.data : ''
    } else {
      text = `[Archivo de tipo ${mimeType} — no se puede extraer texto]`
    }

    return { url: docUrl, title, text, accessible: true }
  }

  /**
   * Reads multiple documents, never throwing — errors are embedded in GoogleDocContent.
   */
  async readDocuments(urls: string[]): Promise<GoogleDocContent[]> {
    const results: GoogleDocContent[] = []
    for (const u of urls) {
      results.push(await this.readDocument(u))
    }
    return results
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts plain text from a Google Docs API document object,
 * preserving paragraph breaks.
 */
function extractTextFromDoc(doc: docs_v1.Schema$Document): string {
  const lines: string[] = []

  for (const element of doc.body?.content ?? []) {
    if (element.paragraph) {
      const parts: string[] = []
      for (const el of element.paragraph.elements ?? []) {
        // content can be string | null | undefined — filter falsy values
        const text = el.textRun?.content
        if (text) {
          parts.push(text)
        }
      }
      const line = parts.join('').replace(/\n$/, '')
      if (line.trim()) lines.push(line)
    }
  }

  return lines.join('\n')
}
