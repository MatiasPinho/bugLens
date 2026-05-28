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
  { id: 'ollama',    name: 'ollama',    description: 'Local y gratis. Requiere Ollama instalado.' },
  { id: 'anthropic', name: 'anthropic', description: 'Alta calidad. Requiere ANTHROPIC_API_KEY.' },
  { id: 'gemini',    name: 'gemini',    description: 'Rápido y económico. Requiere GEMINI_API_KEY.' },
  { id: 'openai',    name: 'openai',    description: 'Requiere OPENAI_API_KEY.' },
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
      alert('Configurá el Client ID y Client Secret de Google antes de autenticarte.')
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
      addLog('info', 'google oauth completado')
    } else {
      addLog('error', `error en google oauth: ${result.error}`)
    }
  }

  const revokeAuth = async () => {
    await window.electronAPI.revokeAuth()
    setGoogleAuth({ authenticated: false })
    addLog('info', 'sesión de google revocada')
  }

  const startBrowserLogin = async () => {
    setBrowserAuthLoading(true)
    addLog('info', 'abriendo ventana de login...')
    const result = await window.electronAPI.startBrowserLogin()
    setBrowserAuthLoading(false)
    if (result.ok) {
      setBrowserAuth({ authenticated: true })
      addLog('info', '✓ sesión del navegador guardada')
    } else {
      addLog('error', `error en login: ${result.error}`)
    }
  }

  const revokeBrowserAuth = async () => {
    await window.electronAPI.revokeBrowserAuth()
    setBrowserAuth({ authenticated: false })
    addLog('info', 'sesión del navegador eliminada')
  }

  const deleteIndex = async () => {
    if (!confirm('¿Borrar el índice del repo?')) return
    await window.electronAPI.deleteIndex()
    onIndexDeleted()
    addLog('info', 'índice eliminado')
  }

  const checkOllama = async () => {
    const status = await window.electronAPI.checkOllama()
    setOllamaStatus(status)
  }

  const startOllama = async () => {
    addLog('info', 'iniciando ollama...')
    const result = await window.electronAPI.startOllama()
    addLog(result.ok ? 'info' : 'error', result.message)
    if (result.ok) {
      const status = await window.electronAPI.checkOllama()
      setOllamaStatus(status)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 max-w-2xl mx-auto font-mono">
      <div className="flex items-center gap-2 mb-6">
        <div className="text-xs font-mono uppercase tracking-wider" style={{ color: '#5d6367' }}>
          ~/buglens/config
        </div>
      </div>

      {/* ── Repos ── */}
      <Section title="repositorios locales">
        <DirField label="repo frontend" value={settings.frontendRepoPath}
          onChange={update('frontendRepoPath')} onPick={() => pickDir('frontendRepoPath')} />
        <DirField label="repo backend" value={settings.backendRepoPath}
          onChange={update('backendRepoPath')} onPick={() => pickDir('backendRepoPath')} />

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button className="btn-primary" onClick={onIndexRepos}
            disabled={isIndexing || (!settings.frontendRepoPath && !settings.backendRepoPath)}>
            {isIndexing ? 'indexando...' : 'indexar repos'}
          </button>
          {hasIndex && !isIndexing && (
            <button className="btn-danger text-xs" onClick={deleteIndex}>borrar índice</button>
          )}
          {hasIndex && !isIndexing && (
            <span className="text-xs" style={{ color: '#9fa5a9' }}>✓ índice activo</span>
          )}
        </div>

        {isIndexing && (
          <div className="mt-3">
            <div className="text-xs mb-1" style={{ color: '#798186' }}>{indexProgress.message}</div>
            <div className="w-full rounded-full h-0.5" style={{ background: 'rgba(75,78,85,0.40)' }}>
              <div className="h-0.5 rounded-full transition-all" style={{
                background: '#798186',
                width: indexProgress.totalFiles > 0
                  ? `${(indexProgress.filesProcessed / indexProgress.totalFiles) * 100}%`
                  : '5%',
              }} />
            </div>
            <div className="text-xs mt-1" style={{ color: '#343d41' }}>
              {indexProgress.filesProcessed}/{indexProgress.totalFiles} archivos
            </div>
          </div>
        )}
      </Section>

      {/* ── Google Docs ── */}
      <Section title="acceso a google docs">
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs" style={{ color: '#cacccc' }}>login con navegador</span>
            <span className="text-xs px-1.5 py-0.5 rounded font-mono"
              style={{ color: '#798186', border: '1px solid rgba(121,129,134,0.30)' }}>recomendado</span>
          </div>
          <p className="text-xs mb-3" style={{ color: '#4b4e55' }}>
            Abre una ventana de Chromium. Las cookies se guardan localmente. No requiere admin.
          </p>

          {browserAuth?.authenticated ? (
            <div className="flex items-center gap-3">
              <span className="text-xs" style={{ color: '#9fa5a9' }}>✓ sesión activa</span>
              <button className="btn-danger text-xs" onClick={revokeBrowserAuth}>cerrar sesión</button>
            </div>
          ) : (
            <button className="btn-primary" onClick={startBrowserLogin} disabled={browserAuthLoading}>
              {browserAuthLoading ? 'esperando login...' : 'conectar con navegador'}
            </button>
          )}
        </div>

        <div className="pt-3" style={{ borderTop: '1px solid rgba(93,99,103,0.18)' }}>
          <button
            className="text-xs transition-colors cursor-pointer flex items-center gap-1.5"
            style={{ color: '#4b4e55' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#798186')}
            onMouseLeave={e => (e.currentTarget.style.color = '#4b4e55')}
            onClick={() => setShowOAuth((v) => !v)}
          >
            <svg width="7" height="7" viewBox="0 0 8 8" fill="currentColor"
              style={{ transform: showOAuth ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
              <path d="M2 1l4 3-4 3V1z"/>
            </svg>
            oauth avanzado
          </button>

          {showOAuth && (
            <div className="mt-3 space-y-3">
              <p className="text-xs" style={{ color: '#343d41' }}>
                Requiere Google Cloud Console con Docs API + Drive API habilitadas.
              </p>
              <div>
                <label className="label">client id</label>
                <input type="text" className="input text-xs" placeholder="1234...apps.googleusercontent.com"
                  value={settings.googleClientId} onChange={update('googleClientId')} />
              </div>
              <div>
                <label className="label">client secret</label>
                <input type="password" className="input text-xs" placeholder="GOCSPX-..."
                  value={settings.googleClientSecret} onChange={update('googleClientSecret')} />
              </div>
              <div className="flex items-center gap-3">
                {googleAuth?.authenticated ? (
                  <>
                    <span className="text-xs" style={{ color: '#9fa5a9' }}>✓ oauth autenticado</span>
                    <button className="btn-danger text-xs" onClick={revokeAuth}>desconectar</button>
                  </>
                ) : (
                  <button className="btn-secondary text-xs" onClick={startAuth} disabled={authLoading}>
                    {authLoading ? 'esperando...' : 'conectar con oauth'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ── LLM ── */}
      <Section title="modelo llm">
        <div className="space-y-1.5 mb-4">
          {LLM_OPTIONS.map((opt) => {
            const isSelected = settings.llmProvider === opt.id
            return (
              <label
                key={opt.id}
                className="flex items-start gap-3 p-2.5 rounded cursor-pointer transition-all"
                style={{
                  border: `1px solid ${isSelected ? 'rgba(201,194,180,0.30)' : 'rgba(93,99,103,0.22)'}`,
                  background: isSelected ? 'rgba(201,194,180,0.05)' : 'transparent',
                }}
              >
                <div className="mt-0.5 flex-shrink-0 w-3.5 h-3.5 rounded-full border flex items-center justify-center transition-all"
                  style={{
                    borderColor: isSelected ? '#c9c2b4' : 'rgba(93,99,103,0.45)',
                    background: isSelected ? '#c9c2b4' : 'transparent',
                  }}>
                  {isSelected && <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#101315' }} />}
                </div>
                <input type="radio" name="llmProvider" value={opt.id}
                  checked={isSelected}
                  onChange={() => setSettings((prev) => ({ ...prev, llmProvider: opt.id }))}
                  className="sr-only" />
                <div className="flex-1">
                  <div className="text-xs font-medium" style={{ color: isSelected ? '#cacccc' : '#798186' }}>
                    {opt.name}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: '#4b4e55' }}>{opt.description}</div>
                </div>
              </label>
            )
          })}
        </div>

        {settings.llmProvider === 'ollama' && (
          <div className="space-y-3">
            <div>
              <label className="label">base url</label>
              <input type="text" className="input text-xs" value={settings.ollamaBaseUrl} onChange={update('ollamaBaseUrl')} />
            </div>
            <div>
              <label className="label">modelo</label>
              <input type="text" className="input text-xs" placeholder="mistral, llama3, codellama..."
                value={settings.llmModel} onChange={update('llmModel')} />
              {ollamaStatus?.models && ollamaStatus.models.length > 0 && (
                <div className="text-xs mt-1" style={{ color: '#343d41' }}>
                  disponibles:{' '}
                  {ollamaStatus.models.map((m, i) => (
                    <button key={i} className="mr-2 transition-colors cursor-pointer"
                      style={{ color: '#798186' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#c9c2b4')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#798186')}
                      onClick={() => setSettings((prev) => ({ ...prev, llmModel: m }))}>
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button className="btn-secondary text-xs" onClick={checkOllama}>verificar ollama</button>
              {ollamaStatus !== null && !ollamaStatus.available && (
                <button className="btn-primary text-xs" onClick={startOllama}>iniciar ollama</button>
              )}
              {ollamaStatus !== null && (
                <span className="text-xs" style={{ color: ollamaStatus.available ? '#9fa5a9' : '#de6145' }}>
                  {ollamaStatus.available ? '✓ disponible' : '✗ no disponible'}
                </span>
              )}
            </div>
          </div>
        )}

        {settings.llmProvider !== 'ollama' && (
          <div>
            <label className="label">modelo (opcional)</label>
            <input type="text" className="input text-xs"
              placeholder="ej: gpt-4o, claude-opus-4-7, gemini-1.5-pro"
              value={settings.llmModel} onChange={update('llmModel')} />
            <div className="text-xs mt-1" style={{ color: '#343d41' }}>
              configurá la api key en el archivo .env
            </div>
          </div>
        )}
      </Section>

      {/* ── Save ── */}
      <div className="flex items-center gap-3 mt-4 mb-8">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? 'guardando...' : 'guardar'}
        </button>
        {saved && <span className="text-xs" style={{ color: '#9fa5a9' }}>✓ guardado</span>}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card mb-3">
      <div className="section-label mb-3">{title}</div>
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
        <input type="text" className="input text-xs flex-1" placeholder="/ruta/al/repo"
          value={value} onChange={onChange} />
        <button className="btn-secondary text-xs flex-shrink-0" onClick={onPick}>explorar</button>
      </div>
    </div>
  )
}
