/**
 * EmptyState.tsx
 *
 * Pantalla inicial cuando no hay análisis aún. Guía al usuario por los pasos:
 *  - sin Excel cargado → "cargá un Excel para empezar"
 *  - Excel cargado pero idle → "tocá 'analizar bugs'"
 *
 * Reemplaza al ProgressLog vacío que no daba contexto.
 */

import React from 'react'

interface Props {
  hasExcel: boolean
  hasIndex: boolean
}

export default function EmptyState({ hasExcel, hasIndex }: Props) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-8">
      <div className="max-w-md w-full space-y-6 text-center">
        {/* Logo / icon principal */}
        <div className="flex justify-center">
          <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-lg"
            style={{ background: 'rgba(201,194,180,0.06)', border: '1px solid rgba(201,194,180,0.18)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ color: '#c9c2b4' }}>
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="11" cy="11" r="2" fill="currentColor"/>
            </svg>
          </div>
        </div>

        <div>
          <div className="text-sm font-mono uppercase tracking-wider mb-1" style={{ color: '#c9c2b4' }}>
            buglens
          </div>
          <p className="text-xs font-mono leading-relaxed" style={{ color: '#798186' }}>
            triage técnico de bugs con análisis profundo del código fuente
          </p>
        </div>

        {/* Pasos visuales del flujo */}
        <div className="space-y-2 text-left">
          <Step
            number={1}
            label="cargar el Excel con los bugs"
            done={hasExcel}
            active={!hasExcel}
            arrow="↖ panel izquierdo"
          />
          <Step
            number={2}
            label="indexar el repo (opcional, mejora análisis)"
            done={hasIndex}
            active={hasExcel && !hasIndex}
            arrow={!hasExcel ? undefined : (hasIndex ? undefined : "→ tab config")}
          />
          <Step
            number={3}
            label="generar triage rápido del batch completo"
            done={false}
            active={hasExcel}
            arrow={hasExcel ? "↖ analizar bugs" : undefined}
          />
          <Step
            number={4}
            label="abrir bugs y generar análisis profundo bajo demanda"
            done={false}
            active={false}
            arrow={undefined}
          />
        </div>

        {/* Atajos de teclado */}
        <div className="pt-4" style={{ borderTop: '1px solid rgba(93,99,103,0.18)' }}>
          <div className="text-xs font-mono uppercase tracking-wider mb-2" style={{ color: '#5d6367' }}>
            atajos
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono" style={{ color: '#4b4e55' }}>
            <Shortcut keys={['j', 'k']} label="navegar bugs" />
            <Shortcut keys={['/']} label="buscar" />
            <Shortcut keys={['enter']} label="expandir bug" />
            <Shortcut keys={['esc']} label="cerrar" />
            <Shortcut keys={['d']} label="análisis profundo" />
            <Shortcut keys={['?']} label="ayuda" />
          </div>
        </div>
      </div>
    </div>
  )
}

function Step({
  number, label, done, active, arrow,
}: { number: number; label: string; done: boolean; active: boolean; arrow?: string }) {
  const textColor = done ? '#9fa5a9' : active ? '#cacccc' : '#4b4e55'
  const dotColor  = done ? '#9fa5a9' : active ? '#c9c2b4' : '#343d41'

  return (
    <div className="flex items-center gap-3">
      <div className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-mono"
        style={{
          background: done ? 'rgba(159,165,169,0.10)' : active ? 'rgba(201,194,180,0.10)' : 'transparent',
          border: `1px solid ${dotColor}`,
          color: dotColor,
        }}>
        {done ? (
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : number}
      </div>
      <span className="text-xs font-mono flex-1" style={{ color: textColor }}>{label}</span>
      {arrow && active && (
        <span className="text-xs font-mono" style={{ color: '#c9a07a' }}>{arrow}</span>
      )}
    </div>
  )
}

function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-1">
        {keys.map((k, i) => (
          <React.Fragment key={i}>
            <kbd className="px-1.5 py-0.5 rounded text-xs font-mono"
              style={{
                background: 'rgba(75,78,85,0.30)',
                border: '1px solid rgba(93,99,103,0.30)',
                color: '#798186',
                minWidth: '1.4em',
                textAlign: 'center',
              }}>
              {k}
            </kbd>
            {i < keys.length - 1 && <span style={{ color: '#343d41' }}>/</span>}
          </React.Fragment>
        ))}
      </div>
      <span style={{ color: '#5d6367' }}>{label}</span>
    </div>
  )
}
