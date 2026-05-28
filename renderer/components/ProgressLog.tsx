import { useEffect, useRef } from 'react'
import type { LogLine } from '../App'

interface Props {
  logs: LogLine[]
}

const levelColor: Record<LogLine['level'], string> = {
  info:  '#343d41',
  warn:  '#c9a07a',
  error: '#de6145',
}

const levelTextColor: Record<LogLine['level'], string> = {
  info:  '#798186',
  warn:  '#c9c2b4',
  error: '#de6145',
}

const levelIndicator: Record<LogLine['level'], string> = {
  info:  '›',
  warn:  '!',
  error: '✕',
}

export default function ProgressLog({ logs }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="h-full flex flex-col" style={{ background: '#101315' }}>
      <div className="px-4 py-2 flex items-center gap-2 flex-shrink-0"
        style={{ borderBottom: '1px solid rgba(93,99,103,0.18)' }}>
        <span className="text-xs font-mono uppercase tracking-wider" style={{ color: '#5d6367' }}>log</span>
        {logs.length > 0 && (
          <span className="text-xs font-mono px-1.5 py-0.5 rounded"
            style={{ color: '#4b4e55', background: 'rgba(75,78,85,0.20)' }}>
            {logs.length}
          </span>
        )}
        {logs.some(l => l.level === 'error') && (
          <span className="text-xs font-mono ml-auto" style={{ color: '#de6145' }}>
            {logs.filter(l => l.level === 'error').length} error{logs.filter(l => l.level === 'error').length > 1 ? 'es' : ''}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-0.5">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: '#343d41' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.5 }}>
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.2"/>
              <line x1="7" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="7" y1="12" x2="17" y2="12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="7" y1="16" x2="11" y2="16" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <span className="text-xs font-mono" style={{ color: '#343d41' }}>esperando actividad...</span>
          </div>
        ) : (
          logs.map((line) => (
            <div key={line.id} className="flex gap-2 leading-relaxed py-0.5 px-1 rounded"
              style={{
                borderLeft: `2px solid ${levelColor[line.level]}`,
                paddingLeft: '0.5rem',
                background: line.level === 'error' ? 'rgba(222,97,69,0.04)' : 'transparent',
              }}>
              <span className="flex-shrink-0 w-16 text-right" style={{ color: '#343d41' }}>
                {new Date(line.timestamp).toLocaleTimeString('es', { hour12: false })}
              </span>
              <span className="flex-shrink-0 w-3 text-center font-bold" style={{ color: levelColor[line.level] }}>
                {levelIndicator[line.level]}
              </span>
              <span className="break-all" style={{ color: levelTextColor[line.level] }}>
                {line.message}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
