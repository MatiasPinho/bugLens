# Bug Analyzer

App de escritorio (Electron + React) para analizar bugs cruzando Excel, Google Docs y repos locales con un LLM.

## Qué hace

1. Cargás un Excel con bugs (con links a Google Docs en cualquier celda)
2. La app lee los documentos de evidencia de Google Docs
3. Busca fragmentos relevantes de tu repo usando embeddings semánticos
4. Manda todo al LLM configurado
5. El LLM clasifica cada bug: categoría, severidad, dificultad, confianza, causa probable, archivos relacionados
6. Exportás un Excel enriquecido con los resultados

---

## Instalación

### Requisitos

- Node.js 20+
- npm 9+
- (Para Ollama) [Ollama](https://ollama.com) instalado y corriendo

### Pasos

```bash
git clone <repo>
cd bug-analyzer
npm install
cp .env.example .env
```

Editá `.env` con tus credenciales (mínimo `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`).

### Modo desarrollo

```bash
npm run dev
```

Abre Electron con hot reload del renderer.

### Build de producción

```bash
npm run build
npm run package
```

Genera el instalador en `release/`.

---

## Configuración de Google OAuth2

### 1. Crear proyecto en Google Cloud

1. Ir a [console.cloud.google.com](https://console.cloud.google.com)
2. Crear un proyecto nuevo (o usar uno existente)
3. En el menú: **APIs & Services → Library**
   - Buscar y habilitar: **Google Docs API**
   - Buscar y habilitar: **Google Drive API**

### 2. Crear credenciales OAuth2

1. Ir a **APIs & Services → Credentials**
2. Click en **+ Create Credentials → OAuth 2.0 Client IDs**
3. Application type: **Desktop app**
4. Nombre: `Bug Analyzer` (cualquier nombre)
5. Click en **Create**
6. Copiar el **Client ID** y **Client Secret**

### 3. Configurar en la app

Opción A — En `.env`:
```env
GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
```

Opción B — En la UI: ir a **Configuración → Google OAuth2** y pegar los valores.

### 4. Autenticar

- En la app, ir a **Configuración → Conectar con Google**
- Se abrirá el navegador con el flow de OAuth
- Autorizá el acceso a tus documentos
- La app recibe el token automáticamente (servidor local en puerto 3000)
- El token se guarda en disco para no repetir el proceso

> **Nota:** Si Google muestra "Esta aplicación no está verificada", click en "Avanzado" → "Ir a Bug Analyzer (no seguro)". Esto es normal para apps de escritorio en desarrollo.

---

## Configuración de Ollama

Ollama es el LLM por defecto (local, gratis, sin API key).

```bash
# Instalar Ollama (Linux/Mac)
curl -fsSL https://ollama.com/install.sh | sh

# Descargar un modelo
ollama pull mistral       # Recomendado — 7B, buena relación calidad/velocidad
ollama pull llama3        # Alternativa
ollama pull codellama     # Mejor para análisis de código

# Verificar que corre
ollama serve              # Debería estar en http://localhost:11434
```

### AMD (ROCm — Arch Linux)

```bash
# Instalar con soporte ROCm
paru -S ollama-rocm       # o yay -S ollama-rocm
# o desde AUR: ollama-git con ROCm

# Forzar GPU AMD
HSA_OVERRIDE_GFX_VERSION=10.3.0 ollama serve  # Para RX 6650 XT (Navi 23)
```

### Windows (Ollama en CPU)

Bajar el instalador desde [ollama.com/download](https://ollama.com/download/windows).
En CPU solo, `mistral` o modelos de 7B son los más prácticos.

---

## Providers de LLM alternativos

La abstracción en `src/llm/client.ts` soporta múltiples providers. Configurás uno con `LLM_PROVIDER` en `.env` o desde la UI.

### Anthropic (Claude)

```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-6   # o claude-opus-4-7 para máxima calidad
```

### Google Gemini

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=AIza...
LLM_MODEL=gemini-1.5-flash    # o gemini-1.5-pro
```

### OpenAI

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o              # o gpt-4o-mini para más barato
```

### Agregar un nuevo provider

1. Editá `src/llm/client.ts`:
   - Agregá el provider al tipo `LLMProvider` en `src/types/index.ts`
   - Implementá la función `callMiProvider(prompt, config)` siguiendo el patrón de las existentes
   - Agregalo al switch en `callLLM()`

2. Agregalo al array `LLM_OPTIONS` en `renderer/components/Settings.tsx`

---

## Formato del Excel de entrada

La app detecta automáticamente las columnas más comunes (case-insensitive, en español e inglés):

| Columna del Excel | Campo mapeado |
|---|---|
| Título / Title / Summary | título del bug |
| Descripción / Description | descripción |
| Pasos / Steps to reproduce | pasos para reproducir |
| Esperado / Expected result | resultado esperado |
| Actual / Actual result | resultado actual |
| Entorno / Environment | entorno |
| Reporter / Reportado por | reportado por |
| Asignado / Assignee | asignado a |
| Estado / Status | estado |
| Prioridad / Priority | prioridad |

Los links a Google Docs/Drive se detectan en **cualquier celda** de la fila.
Los campos no reconocidos se incluyen igualmente como "campos adicionales" en el contexto del LLM.

---

## Personalizar el prompt del LLM

El prompt está en `src/prompts/bugClassifier.ts`. Las secciones marcadas con `★` son las más importantes para adaptar a tu dominio:

- **Categorías válidas**: Modificá si tus bugs se organizan distinto (ej: agregar `mobile`, `infra`, `security`)
- **Severidades**: Adaptá las definiciones a tu SLA
- **Examples few-shot**: Reemplazá con bugs reales de tu proyecto para mejor precisión
- **Contexto del sistema prompt**: Describí tu stack tecnológico para que el LLM entienda mejor

---

## Estructura del proyecto

```
bug-analyzer/
├── electron/
│   ├── main.ts           # Main process: IPC handlers, ventana, pipeline
│   └── preload.ts        # Expone electronAPI al renderer (contextBridge)
├── src/
│   ├── pipeline/
│   │   ├── excelReader.ts      # Lee/escribe Excel con SheetJS
│   │   ├── googleDocsReader.ts # OAuth2 + lectura de Docs/Drive
│   │   ├── repoIndexer.ts      # Indexación con ChromaDB
│   │   └── bugEnricher.ts      # Combina Excel + docs + código
│   ├── llm/
│   │   └── client.ts           # Abstracción: Ollama / Anthropic / Gemini / OpenAI
│   ├── prompts/
│   │   └── bugClassifier.ts    # System prompt + few-shots + user prompt builder
│   └── types/
│       └── index.ts            # Todos los tipos TypeScript compartidos
├── renderer/
│   ├── components/
│   │   ├── FileUpload.tsx      # Drag & drop del Excel
│   │   ├── BugTable.tsx        # Tabla con filtros y detalle expandible
│   │   ├── ProgressLog.tsx     # Log en tiempo real
│   │   └── Settings.tsx        # Pantalla de configuración
│   ├── App.tsx                 # Root component + estado global
│   ├── main.tsx                # Entry point React
│   ├── styles.css              # Tailwind
│   └── electron.d.ts           # Tipos de window.electronAPI
├── .env.example
├── package.json
├── tsconfig.json
├── tsconfig.electron.json
└── vite.config.ts
```

---

## Solución de problemas frecuentes

### ChromaDB no arranca

ChromaDB v1.9+ usa un cliente HTTP que necesita un servidor separado. Si da errores de conexión:

```bash
# Opción: usar chromadb embedded (sin servidor)
npm install chromadb@1.8.x
```

O configurar el servidor ChromaDB:
```bash
pip install chromadb
chroma run --path ./chroma-index --port 8000
```
Y cambiar `path` en `RepoIndexer` a `http://localhost:8000`.

### Error "cannot find module electron-store"

```bash
npm install electron-store@10
```

Si hay errores de ESM/CJS, agregar al `package.json`:
```json
"type": "module"
```

### Ollama timeout

Los modelos grandes en CPU son lentos. Aumentar el timeout en `src/llm/client.ts`:
```typescript
signal: AbortSignal.timeout(300_000), // 5 minutos
```

### Google OAuth: "redirect_uri_mismatch"

El redirect URI debe ser exactamente `http://localhost:3000/oauth2callback`.
Verificalo en Google Cloud Console → Credentials → tu OAuth client → Authorized redirect URIs.

---

## Licencia

MIT
