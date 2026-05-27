// Driver Playwright para Bug Analyzer (Electron)
// Uso: xvfb-run -a node .claude/driver.mjs
import { _electron as electron } from 'playwright-core'
import * as readline from 'node:readline'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_DIR = path.resolve(__dirname, '..')
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/shots'
fs.mkdirSync(SHOT_DIR, { recursive: true })

const ELECTRON_BIN = path.join(APP_DIR, 'node_modules/electron/dist/electron')

let app = null
let page = null
let viteServer = null

const COMMANDS = {
  async launch() {
    if (app) return console.log('ya lanzado')

    // 1. Arrancar Vite dev server en proceso
    console.log('Arrancando Vite...')
    viteServer = await createServer({
      root: path.join(APP_DIR, 'renderer'),
      base: './',
      server: { port: 5173 },
    })
    await viteServer.listen()
    console.log('✓ Vite en http://localhost:5173')

    // 2. Lanzar Electron
    console.log('Lanzando Electron...')
    app = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: ['--no-sandbox', APP_DIR],
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ':99',
        NODE_ENV: 'development',
      },
      timeout: 30_000,
    })

    // Esperar a que cargue la UI (Vite)
    await new Promise(r => setTimeout(r, 6_000))

    // Buscar la ventana de la app (no DevTools)
    page = app.windows().find(w => !w.url().startsWith('devtools://'))
      ?? await app.firstWindow()

    console.log('launched.', app.windows().length, 'ventana(s):')
    for (const w of app.windows()) console.log(' ', w.url())
  },

  async ss(name) {
    if (!page) return console.log('ERROR: ejecutá launch primero')
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png')
    await page.screenshot({ path: f, fullPage: false })
    console.log('screenshot:', f)
  },

  async click(sel) {
    if (!page) return console.log('ERROR: launch primero')
    const r = await page.evaluate(s => {
      const el = document.querySelector(s)
      if (!el) return 'NOT_FOUND'
      el.click(); return 'OK'
    }, sel)
    console.log('click', sel, '→', r)
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch primero')
    const r = await page.evaluate(t => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')]
      const el = els.find(e => e.textContent?.trim() === t)
        ?? els.find(e => e.textContent?.includes(t))
      if (!el) return 'NOT_FOUND'
      el.click(); return 'OK: ' + el.tagName
    }, text)
    console.log('click-text', JSON.stringify(text), '→', r)
  },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch primero')
    try {
      await page.waitForSelector(sel, { timeout: 10_000 })
      console.log('found:', sel)
    } catch {
      console.log('TIMEOUT:', sel)
    }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch primero')
    console.log(await page.evaluate(
      s => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
      sel || null
    ))
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch primero')
    try { console.log(JSON.stringify(await page.evaluate(expr))) }
    catch (e) { console.log('ERROR:', e.message) }
  },

  async windows() {
    if (!app) return console.log('ERROR: launch primero')
    for (const w of app.windows()) console.log(' ', w.url())
  },

  async quit() {
    if (app) await app.close().catch(() => {})
    if (viteServer) await viteServer.close()
    app = null; page = null; viteServer = null
  },

  help() { console.log('comandos:', Object.keys(COMMANDS).join(', ')) },
}

const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') })
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' })

rl.on('line', async line => {
  const [cmd, ...rest] = line.trim().split(/\s+/)
  if (!cmd) return rl.prompt()
  const fn = COMMANDS[cmd]
  if (!fn) { console.log('desconocido:', cmd, '— probá: help'); return rl.prompt() }
  try { await fn(rest.join(' ')) } catch (e) { console.log('ERROR:', e.message) }
  if (cmd === 'quit') { rl.close(); process.exit(0) }
  rl.prompt()
})
rl.on('close', async () => { await COMMANDS.quit(); process.exit(0) })

console.log('Bug Analyzer driver — "launch" para iniciar, "help" para comandos')
rl.prompt()
