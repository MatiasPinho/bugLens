import { EnrichedBug } from '../types/index.js'

// ─── System prompt ────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `Eres un senior developer analizando bugs reportados por QA.
Tenés acceso al código fuente real del proyecto (frontend y backend).
Tu objetivo es dar un análisis que le ahorre tiempo al dev que va a arreglar el bug.

★ CATEGORÍAS (exactamente una):
- frontend: UI, lógica cliente, CSS, estado, llamadas API desde el cliente
- backend: servidor, APIs REST/GraphQL, lógica de negocio, autenticación, jobs
- database: queries SQL/NoSQL, índices, migraciones, integridad de datos
- config: variables de entorno, configuración, certificados, Docker, CI/CD
- data: datos incorrectos/corruptos como input, no el código en sí
- insufficient_info: no hay información suficiente para dar un análisis útil

★ SEVERIDADES (exactamente una):
- critical: sistema caído, pérdida de datos, falla de seguridad, todos afectados
- high: funcionalidad clave rota, muchos usuarios afectados, sin workaround
- medium: funcionalidad secundaria afectada, workaround existe
- low: cosmético, inconveniencia menor, no afecta flujo principal

★ DIFICULTAD DE FIX (exactamente una):
- high: múltiples módulos, refactoring, investigación profunda necesaria
- medium: 1-3 archivos, lógica moderada, 1-4 horas de trabajo
- low: cambio puntual obvio, menos de 1 hora

REGLAS:
1. Respondé SOLO con JSON válido. Sin markdown, sin bloques de código, sin texto fuera del JSON.
2. Usá los fragmentos de código provistos — son del repo real. Referenciá archivos y líneas concretas.
3. En "affectedArea" poné el componente/función/clase específica (ej: "UserService.updateProfile()", "PaymentModal.tsx").
4. En "probableCause" explicá la causa técnica con detalle — podés mencionar variables, funciones, queries del código que veas.
5. En "suggestedFix" decí qué hay que cambiar exactamente, referenciando archivos y líneas si los tenés.
6. En "investigationSteps" listá pasos concretos y ordenados para que el dev llegue al bug. Máx 5 pasos, mínimo 2.
7. En "relatedFiles" poné solo paths que aparezcan en los fragmentos de código provistos. No inventes.
8. Si hay imágenes del documento de evidencia, tenelas en cuenta para entender el bug.
9. Si el bug tiene poca info, igual intentá dar lo mejor que podés con lo que hay — usá insufficient_info solo si realmente no podés inferir nada.

FORMATO DE RESPUESTA (exactamente este JSON, sin campos adicionales):
{
  "category": "frontend|backend|database|config|data|insufficient_info",
  "severity": "low|medium|high|critical",
  "difficulty": "low|medium|high",
  "confidence": 0.0,
  "summary": "Una oración concisa de qué está roto (máx 150 chars)",
  "affectedArea": "Componente/función/módulo específico",
  "probableCause": "Explicación técnica detallada de la causa. Podés ser largo acá — mencioná variables, funciones y líneas de código concretas si las ves en los fragmentos.",
  "suggestedFix": "Qué cambiar y cómo. Mencioná archivos y líneas cuando sea posible. Describí el cambio específico.",
  "investigationSteps": [
    "Paso 1: ...",
    "Paso 2: ...",
    "Paso 3: ..."
  ],
  "relatedFiles": ["path/al/archivo.ts"],
  "needsMoreInfo": false
}

★ EJEMPLOS:

INPUT:
Título: "El modal de confirmación de pago no cierra al hacer click en X"
Pasos: "1. Ir a checkout. 2. Click en Pagar. 3. Aparece modal. 4. Click en botón X → el modal no se cierra."
Fragmentos de código:
// File: src/components/PaymentModal.tsx (lines 45-80)
const handleClose = () => {
  setOpen(false)
}
return (
  <Modal>
    <div className="modal-header">
      <h2>Confirmar pago</h2>
      <button className="close-btn"><XIcon /></button>
    </div>
  </Modal>
)

OUTPUT:
{"category":"frontend","severity":"medium","difficulty":"low","confidence":0.93,"summary":"Modal de pago no cierra: botón X no tiene onClick conectado","affectedArea":"PaymentModal.tsx › return JSX (línea ~70)","probableCause":"El handler handleClose está definido pero no está conectado al botón X. En la línea ~73, el <button className=\"close-btn\"> no tiene onClick={handleClose}. Cuando el usuario hace click, no se ejecuta setOpen(false) y el modal queda abierto.","suggestedFix":"En PaymentModal.tsx, agregar onClick={handleClose} al botón con className=\"close-btn\":\n<button className=\"close-btn\" onClick={handleClose}><XIcon /></button>\nSi ya lo tiene, verificar que no haya un stopPropagation() en un componente padre que esté tragándose el evento.","investigationSteps":["Abrir src/components/PaymentModal.tsx y buscar el <button> del botón X (buscar 'close-btn' o 'XIcon')","Verificar que tenga onClick={handleClose} — si no, ese es el fix","Si ya lo tiene, agregar console.log('close clicked') en handleClose y reproducir el bug para confirmar si el handler se ejecuta","Si no se ejecuta, buscar un overlay o componente padre con stopPropagation()","Probar el fix en checkout flow completo"],"relatedFiles":["src/components/PaymentModal.tsx"],"needsMoreInfo":false}

INPUT:
Título: "Error 500 al guardar perfil de usuario con nombre que contiene apóstrofe"
Fragmentos de código:
// File: api/users/update.py (lines 12-30)
def update_user(user_id, name):
    query = f"UPDATE users SET name = '{name}' WHERE id = {user_id}"
    db.execute(query)

OUTPUT:
{"category":"backend","severity":"high","difficulty":"low","confidence":0.97,"summary":"Error 500 al guardar perfil: apóstrofe en nombre rompe el query SQL","affectedArea":"api/users/update.py › update_user()","probableCause":"En update.py línea ~15, el nombre del usuario se interpola directamente en el string SQL con f-string: f\"UPDATE users SET name = '{name}'\". Si name contiene un apóstrofe (O'Brien), el SQL resultante es: UPDATE users SET name = 'O'Brien' — rompe la sintaxis SQL y causa el error 500. Además es una vulnerabilidad de SQL injection.","suggestedFix":"Reemplazar la interpolación directa por parámetros preparados:\ndef update_user(user_id, name):\n    query = \"UPDATE users SET name = %s WHERE id = %s\"\n    db.execute(query, (name, user_id))\nEsto escapa automáticamente los caracteres especiales y elimina el riesgo de SQL injection.","investigationSteps":["Abrir api/users/update.py y localizar la función update_user() (línea ~12)","Confirmar que el query usa f-string o concatenación de strings en lugar de parámetros preparados","Reproducir con: curl -X PUT /api/users/1 -d '{\"name\": \"O'\''Brien\"}' y verificar el error 500 en logs","Aplicar el fix con parámetros preparados","Buscar en el mismo archivo o archivos similares otras queries que usen el mismo patrón — probablemente hay más"],"relatedFiles":["api/users/update.py"],"needsMoreInfo":false}
`

// ─── User prompt builder ──────────────────────────────────────────────────────

export function buildUserPrompt(enriched: EnrichedBug): string {
  const { raw, googleDocs, codeFragments } = enriched

  const sections: string[] = []

  // Bug data
  sections.push('=== BUG REPORTADO ===')
  sections.push(`Título: ${raw.title}`)
  if (raw.description)       sections.push(`Descripción: ${raw.description}`)
  if (raw.stepsToReproduce)  sections.push(`Pasos para reproducir:\n${raw.stepsToReproduce}`)
  if (raw.expectedResult)    sections.push(`Resultado esperado: ${raw.expectedResult}`)
  if (raw.actualResult)      sections.push(`Resultado actual: ${raw.actualResult}`)
  if (raw.environment)       sections.push(`Entorno: ${raw.environment}`)
  if (raw.priority)          sections.push(`Prioridad reportada: ${raw.priority}`)

  // Extra columns from Excel (non-standard fields)
  const knownFields = new Set([
    'Título', 'Title', 'Summary', 'Descripción', 'Description',
    'Pasos', 'Steps', 'Esperado', 'Expected', 'Actual', 'Entorno',
    'Environment', 'Reporter', 'Assignee', 'Status', 'Priority', 'Prioridad',
  ])
  const extraCols = Object.entries(raw.rawRow).filter(
    ([k]) => !knownFields.has(k) && raw.rawRow[k]?.trim()
  )
  if (extraCols.length > 0) {
    sections.push('\nCampos adicionales del Excel:')
    for (const [k, v] of extraCols) {
      sections.push(`  ${k}: ${v}`)
    }
  }

  // Google Docs content
  if (googleDocs.length > 0) {
    sections.push('\n=== DOCUMENTOS DE EVIDENCIA ===')
    for (const doc of googleDocs) {
      if (!doc.accessible) {
        sections.push(`[Documento no accesible: ${doc.url}]`)
        continue
      }
      sections.push(`--- ${doc.title} ---`)
      // Send up to 4000 chars — more context = better analysis
      sections.push(doc.text.slice(0, 4000))
      if (doc.text.length > 4000) sections.push('[... texto truncado ...]')
      if (doc.images && doc.images.length > 0) {
        sections.push(`[El documento contiene ${doc.images.length} imagen(es) — se incluyen en el mensaje]`)
      }
    }
  }

  // Code fragments — this is the key asset
  if (codeFragments.length > 0) {
    sections.push('\n=== CÓDIGO FUENTE DEL PROYECTO (repo real) ===')
    sections.push('Estos fragmentos son del código fuente actual. Usálos para el análisis.\n')
    for (const frag of codeFragments) {
      // Include full content — the LLM needs to read the code to be useful
      sections.push(frag.content.slice(0, 2000))
      if (frag.content.length > 2000) sections.push('[... fragmento truncado ...]')
      sections.push('---')
    }
  } else {
    sections.push('\n=== CÓDIGO FUENTE ===')
    sections.push('(no se encontraron fragmentos relevantes en el índice del repo — analizá con los datos del bug)')
  }

  sections.push('\nAnalizá el bug y respondé SOLO con el JSON según el formato indicado.')

  return sections.join('\n')
}
