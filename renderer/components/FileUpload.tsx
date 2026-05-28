import React, { useCallback, useState } from 'react'

interface Props {
  excelPath: string | null
  onFileSelected: (path: string) => void
  disabled?: boolean
}

export default function FileUpload({ excelPath, onFileSelected, disabled }: Props) {
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragOver(false)
      if (disabled) return

      const file = e.dataTransfer.files[0]
      if (!file) return

      const ext = file.name.split('.').pop()?.toLowerCase()
      if (!['xlsx', 'xls', 'csv'].includes(ext ?? '')) {
        alert('Solo se aceptan archivos .xlsx, .xls o .csv')
        return
      }

      const path = (file as { path?: string }).path
      if (path) {
        onFileSelected(path)
      } else {
        alert('No se pudo obtener el path del archivo.')
      }
    },
    [disabled, onFileSelected]
  )

  const handleBrowse = useCallback(async () => {
    if (disabled) return
    const path = await window.electronAPI.openExcelDialog()
    if (path) onFileSelected(path)
  }, [disabled, onFileSelected])

  const fileName = excelPath ? excelPath.split(/[\\/]/).pop() : null

  return (
    <div className="card">
      <div className="label mb-2">archivo de entrada</div>

      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onClick={handleBrowse}
        className="rounded-md text-center transition-all select-none"
        style={{
          padding: excelPath ? '0.75rem 1rem' : '1.5rem 1rem',
          border: `1px dashed ${dragOver ? 'rgba(201,194,180,0.55)' : excelPath ? 'rgba(159,165,169,0.38)' : 'rgba(93,99,103,0.32)'}`,
          background: dragOver ? 'rgba(201,194,180,0.04)' : excelPath ? 'rgba(159,165,169,0.03)' : 'transparent',
          opacity: disabled ? 0.30 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {excelPath ? (
          <div className="flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ color: '#9fa5a9', flexShrink: 0 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <polyline points="10 9 9 9 8 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-xs font-mono truncate" style={{ color: '#cacccc' }}>{fileName}</div>
              <div className="text-xs font-mono mt-0.5" style={{ color: '#4b4e55' }}>click para cambiar</div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              style={{ color: dragOver ? '#9fa5a9' : '#4b4e55', transition: 'color 0.15s' }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <polyline points="17 8 12 3 7 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <div>
              <div className="text-xs font-mono" style={{ color: dragOver ? '#9fa5a9' : '#5d6367' }}>
                arrastrar o click para seleccionar
              </div>
              <div className="text-xs font-mono mt-1" style={{ color: '#343d41' }}>
                .xlsx · .xls · .csv
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
