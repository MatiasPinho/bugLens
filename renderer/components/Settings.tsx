import React, { useState, useEffect } from 'react'
import type { LogLine } from '../App'

interface SettingsData {
  frontendRepoPath: string
  backendRepoPath: string
  googleClientId: string
  googleClientSecret: string
  llmProvider: string
  llmModel: string
  ollamaBaseUrl: string
  indexPath: string
}

interface Props {
  onIndexRepos: () => Promise<void>
  isIndexing: boolean
  indexProgress: { filesProcessed: number; totalFiles: number; message: string }
  hasIndex: boolean
  onIndexDeleted: () => void
  addLog: (level: LogLine['level'], message: string) => void
}

const LLM_OPTIONS = [
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local y gratis. Requiere Ollama instalado. Modelos recomendados: mistral, llama3, codellama.',
    icon: '🦙',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    description: 'Alta calidad. Requiere API key. Modelo por defecto: claude-sonnet-4-6.',
    icon: '🤖',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Rápido y económico. Requiere API key. Modelo por defecto: gemini-1.5-flash.',
    icon: '✨',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Ampliamente adoptado. Requiere API key. Modelo por defecto: gpt-4o-mini.',
    icon: '🧠',
  },
]

export default function Settings({
  onIndexRepos,
  isIndexing,
  indexProgress,
  hasIndex,
  onIndexDeleted,
  addLog,
}: Props) {
  const [settings, setSettings] = useState<SettingsData>({
    frontendRepoPath: '',
    backendRepoPath: '',
    googleClientId: '',
    googleClientSecret: '',
    llmProvider: 'ollama',
    llmModel: '',
    ollamaBaseUrl: 'http://localhost:11434',
    indexPath: '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [googleAuth, setGoogleAuth] = useState<{ authenticated: boolean } | null>(null)
  const [browserAuth, setBrowserAuth] = useState<{ authenticated: boolean } | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [browserAuthLoading, setBrowserAuthLoading] = useState(false)
  const [ollamaStatus, setOllamaStatus] = useState<{ available: boolean; models?: string[] } | null>(null)
  const [showOAuth, setShowOAuth] = useState(false)

  useEffect(() => {
    window.electronAPI.getSettings().then((s: SettingsData) => setSettings(s))
    window.electronAPI.getAuthStatus().then(setGoogleAuth)
    window.electronAPI.getBrowserAuthStatus().then(setBrowserAuth)
    window.electronAPI.checkOllama().then(setOllamaStatus)
  }, [])

  const update = (key: keyof SettingsData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSettings((prev) => ({ ...prev, [key]: e.target.value }))

  const pickDir = async (key: keyof SettingsData) => {
    const path = await window.electronAPI.pickDirectory()
    if (path) setSettings((prev) => ({ ...prev, [key]: path }))
  }

  const save = async () => {
    setSaving(true)
    await window.electronAPI.saveSettings(settings as unknown as Record<string, string>)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const startAuth = async () => {
    if (!settings.googleClientId || !settings.googleClientSecret) {
      alert('Necesitás configurar el Client ID y Client Secret de Google antes de autenticarte.')
      return
    }
    await window.electronAPI.saveSettings({
      googleClientId: settings.googleClientId,
      googleClientSecret: settings.googleClientSecret,
    })
    setAuthLoading(true)
    const result = await window.electronAPI.startAuth()
    setAuthLoading(false)
    if (result.ok) {
      setGoogleAuth({ authenticated: true })
      addLog('info', 'Google OAuth completado correctamente')
    } else {
      addLog('error', `Error en Google OAuth: ${result.error}`)
    }
  }

  const revokeAuth = async () => {
    await window.electronAPI.revokeAuth()
    setGoogleAuth({ authenticated: false })
    addLog('info', 'Sesión de Google revocada')
  }

  const startBrowserLogin = async () => {
    setBrowserAuthLoading(true)
    addLog('info', 'Abriendo ventana de login de Google...')
    const result = await window.electronAPI.startBrowserLogin()
    setBrowserAuthLoading(false)
    if (result.ok) {
      setBrowserAuth({ authenticated: true })
      addLog('info', '✓ Sesión del navegador guardada — los docs se van a leer automáticamente')
    } else {
      addLog('error', `Error en login del navegador: ${result.error}`)
    }
  }

  const revokeBrowserAuth = async () => {
    await window.electronAPI.revokeBrowserAuth()
    setBrowserAuth({ authenticated: false })
    addLog('info', 'Sesión del navegador eliminada')
  }

  const deleteIndex = async () => {
    if (!confirm('¿Borrar el índice del repo? Tendrás que re-indexar.')) return
    await window.electronAPI.deleteIndex()
    onIndexDeleted()
    addLog('info', 'Índice eliminado')
  }

  const checkOllama = async () => {
    const status = await window.electronAPI.checkOllama()
    setOllamaStatus(status)
  }

  const startOllama = async () => {
    addLog('info', 'Iniciando Ollama...')
    const result = await window.electronAPI.startOllama()
    addLog(result.ok ? 'info' : 'error', result.message)
    if (result.ok) {
      const status = await window.electronAPI.checkOllama()
      setOllamaStatus(status)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold text-gray-100 mb-6">Configuración</h2>

      {/* ─── Repos ─────────────────────────────────────────────── */}
      <Section title="📁 Repositorios locales">
        <DirField
          label="Repo Frontend"
          value={settings.frontendRepoPath}
          onChange={update('frontendRepoPath')}
          onPick={() => pickDir('frontendRepoPath')}
        />
        <DirField
          label="Repo Backend"
          value={settings.backendRepoPath}
          onChange={update('backendRepoPath')}
          onPick={() => pickDir('backendRepoPath')}
        />

        <div className="mt-4 flex items-center gap-3">
          <button
            className="btn-primary flex items-center gap-2"
            onClick={onIndexRepos}
            disabled={isIndexing || (!settings.frontendRepoPath && !settings.backendRepoPath)}
          >
            {isIndexing ? '⏳ Indexando...' : '🔍 Indexar repos'}
          </button>

          {hasIndex && !isIndexing && (
            <button className="btn-danger text-sm" onClick={deleteIndex}>
              🗑 Borrar índice
            </button>
          )}

          {hasIndex && !isIndexing && (
            <span className="text-xs text-green-400">✓ Índice activo</span>
          )}
        </div>

        {isIndexing && (
          <div className="mt-3">
            <div className="text-sm text-gray-400 mb-1">{indexProgress.message}</div>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div
                className="bg-indigo-500 h-2 rounded-full transition-all"
                style={{
                  width: indexProgress.totalFiles > 0
                    ? `${(indexProgress.filesProcessed / indexProgress.totalFiles) * 100}%`
                    : '5%',
                }}
              />
            </div>
            <div className="text-xs text-gray-600 mt-1">
              {indexProgress.filesProcessed} / {indexProgress.totalFiles} archivos
            </div>
          </div>
        )}
      </Section>

      {/* ─── Google Docs access ─────────────────────────────────── */}
      <Section title="📄 Acceso a Google Docs">
        {/* ── Browser session (recommended) ── */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-gray-200">🌐 Login con navegador</span>
            <span className="text-xs bg-indigo-900 text-indigo-300 px-2 py-0.5 rounded-full">Recomendado</span>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Abre una ventana de Chromium donde hacés login en Google normalmente.
            Las cookies se guardan localmente. No requiere admin, no requiere aprobar la app en Google Cloud.
          </p>

          {browserAuth?.authenticated ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-green-400">✓ Sesión activa</span>
              <button className="btn-danger text-sm" onClick={revokeBrowserAuth}>
                Cerrar sesión
              </button>
            </div>
          ) : (
            <button
              className="btn-primary flex items-center gap-2"
              onClick={startBrowserLogin}
              disabled={browserAuthLoading}
            >
              {browserAuthLoading
                ? '⏳ Esperando login...'
                : '🌐 Conectar con navegador'}
            </button>
          )}
        </div>

        {/* ── OAuth toggle ── */}
        <div className="border-t border-gray-800 pt-3">
          <button
            className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
            onClick={() => setShowOAuth((v) => !v)}
          >
            {showOAuth ? '▼' : '▶'} OAuth avanzado (requiere Google Cloud y aprobación del admin)
          </button>

          {showOAuth && (
            <div className="mt-3">
              <p className="text-xs text-gray-600 mb-3">
                Requiere crear un proyecto en Google Cloud Console con Docs API + Drive API habilitadas.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="label">Client ID</label>
                  <input
                    type="text"
                    className="input font-mono text-sm"
                    placeholder="1234567890-abc...apps.googleusercontent.com"
                    value={settings.googleClientId}
                    onChange={update('googleClientId')}
                  />
                </div>
                <div>
                  <label className="label">Client Secret</label>
                  <input
                    type="password"
                    className="input font-mono text-sm"
                    placeholder="GOCSPX-..."
                    value={settings.googleClientSecret}
                    onChange={update('googleClientSecret')}
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                {googleAuth?.authenticated ? (
                  <>
                    <span className="text-sm text-green-400">✓ OAuth autenticado</span>
                    <button className="btn-danger text-sm" onClick={revokeAuth}>
                      Desconectar
                    </button>
                  </>
                ) : (
                  <button
                    className="btn-secondary flex items-center gap-2"
                    onClick={startAuth}
                    disabled={authLoading}
                  >
                    {authLoading ? '⏳ Esperando...' : '🔗 Conectar con OAuth'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ─── LLM ────────────────────────────────────────────────── */}
      <Section title="🤖 Modelo LLM">
        <div className="space-y-2">
          {LLM_OPTIONS.map((opt) => (
            <label
              key={opt.id}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                ${settings.llmProvider === opt.id
                  ? 'border-indigo-600 bg-indigo-950/50'
                  : 'border-gray-800 hover:border-gray-700'
                }`}
            >
              <input
                type="radio"
                name="llmProvider"
                value={opt.id}
                checked={settings.llmProvider === opt.id}
                onChange={() => setSettings((prev) => ({ ...prev, llmProvider: opt.id }))}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-200">
                  {opt.icon} {opt.name}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{opt.description}</div>
              </div>
            </label>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {settings.llmProvider === 'ollama' && (
            <>
              <div>
                <label className="label">Base URL de Ollama</label>
                <input
                  type="text"
                  className="input font-mono text-sm"
                  value={settings.ollamaBaseUrl}
                  onChange={update('ollamaBaseUrl')}
                />
              </div>
              <div>
                <label className="label">Modelo</label>
                <input
                  type="text"
                  className="input font-mono text-sm"
                  placeholder="mistral, llama3, codellama..."
                  value={settings.llmModel}
                  onChange={update('llmModel')}
                />
                {ollamaStatus?.models && ollamaStatus.models.length > 0 && (
                  <div className="text-xs text-gray-500 mt-1">
                    Modelos disponibles:{' '}
                    {ollamaStatus.models.map((m, i) => (
                      <button
                        key={i}
                        className="text-indigo-400 hover:underline mr-2"
                        onClick={() => setSettings((prev) => ({ ...prev, llmModel: m }))}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button className="btn-secondary text-sm" onClick={checkOllama}>
                  Verificar Ollama
                </button>
                {ollamaStatus !== null && !ollamaStatus.available && (
                  <button className="btn-primary text-sm" onClick={startOllama}>
                    ▶ Iniciar Ollama
                  </button>
                )}
                {ollamaStatus !== null && (
                  <span className={`text-sm ${ollamaStatus.available ? 'text-green-400' : 'text-red-400'}`}>
                    {ollamaStatus.available ? '✓ Disponible' : '✗ No disponible'}
                  </span>
                )}
              </div>
            </>
          )}

          {settings.llmProvider !== 'ollama' && (
            <div>
              <label className="label">Modelo (opcional — deja vacío para usar el default)</label>
              <input
                type="text"
                className="input font-mono text-sm"
                placeholder="ej: gpt-4o, claude-opus-4-7, gemini-1.5-pro"
                value={settings.llmModel}
                onChange={update('llmModel')}
              />
              <div className="text-xs text-gray-500 mt-1">
                Configurá la API key en el archivo <span className="font-mono">.env</span>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ─── Save button ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mt-6">
        <button
          className="btn-primary px-8"
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Guardando...' : 'Guardar configuración'}
        </button>
        {saved && <span className="text-sm text-green-400">✓ Guardado</span>}
      </div>

      <div className="h-16" />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card mb-4">
      <h3 className="font-medium text-gray-200 mb-4">{title}</h3>
      {children}
    </div>
  )
}

function DirField({
  label,
  value,
  onChange,
  onPick,
}: {
  label: string
  value: string
  onChange: React.ChangeEventHandler<HTMLInputElement>
  onPick: () => void
}) {
  return (
    <div className="mb-3">
      <label className="label">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          className="input font-mono text-sm flex-1"
          placeholder="/ruta/al/repo"
          value={value}
          onChange={onChange}
        />
        <button className="btn-secondary flex-shrink-0" onClick={onPick}>
          Explorar
        </button>
      </div>
    </div>
  )
}
