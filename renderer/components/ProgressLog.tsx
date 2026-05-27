import { useEffect, useRef } from 'react'
import type { LogLine } from '../App'

interface Props {
  logs: LogLine[]
}

const levelStyles: Record<string, string> = {
  info: 'text-gray-300',
  warn: 'text-amber-400',
  error: 'text-red-400',
}

const levelPrefix: Record<string, string> = {
  info: '  ',
  warn: '⚠ ',
  error: '✗ ',
}

export default function ProgressLog({ logs }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-2 border-b border-gray-800 flex items-center gap-2">
        <div className="text-xs text-gray-500 font-mono uppercase tracking-wider">Log</div>
        {logs.length > 0 && (
          <span className="text-xs text-gray-600">{logs.length} líneas</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs">
        {logs.length === 0 ? (
          <div className="text-gray-600 text-center mt-8">
            El log aparecerá aquí durante el análisis...
          </div>
        ) : (
          logs.map((line) => (
            <div key={line.id} className={`flex gap-2 leading-relaxed ${levelStyles[line.level]}`}>
              <span className="text-gray-700 flex-shrink-0">
                {new Date(line.timestamp).toLocaleTimeString('es', { hour12: false })}
              </span>
              <span className="flex-shrink-0">{levelPrefix[line.level]}</span>
              <span className="break-all">{line.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
