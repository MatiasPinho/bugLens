import { useEffect, useRef } from 'react'
import type { LogLine } from '../App'

interface Props {
  logs: LogLine[]
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
        <span className="text-xs font-mono uppercase tracking-wider" style={{ color: '#343d41' }}>log</span>
        {logs.length > 0 && (
          <span className="text-xs font-mono" style={{ color: '#343d41' }}>{logs.length}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs">
        {logs.length === 0 ? (
          <div className="text-center mt-10 font-mono" style={{ color: '#343d41' }}>
            _ esperando...
          </div>
        ) : (
          logs.map((line) => (
            <div key={line.id} className="flex gap-2 leading-relaxed">
              <span className="flex-shrink-0" style={{ color: '#343d41' }}>
                {new Date(line.timestamp).toLocaleTimeString('es', { hour12: false })}
              </span>
              <span className="flex-shrink-0" style={{
                color: line.level === 'error' ? '#de6145' : line.level === 'warn' ? '#c9a07a' : '#343d41'
              }}>
                {line.level === 'error' ? '✗' : line.level === 'warn' ? '⚠' : '›'}
              </span>
              <span className="break-all" style={{
                color: line.level === 'error' ? '#de6145' : line.level === 'warn' ? '#c9c2b4' : '#798186'
              }}>
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
