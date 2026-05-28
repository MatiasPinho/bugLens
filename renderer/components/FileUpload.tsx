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

  const borderColor = dragOver
    ? 'rgba(121,129,134,0.60)'
    : excelPath
    ? 'rgba(159,165,169,0.35)'
    : 'rgba(93,99,103,0.28)'

  const bgColor = dragOver
    ? 'rgba(121,129,134,0.06)'
    : excelPath
    ? 'rgba(159,165,169,0.04)'
    : 'transparent'

  return (
    <div className="card">
      <div className="label mb-2">archivo excel</div>

      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onClick={handleBrowse}
        className="rounded p-5 text-center cursor-pointer transition-all"
        style={{
          border: `1px dashed ${borderColor}`,
          background: bgColor,
          opacity: disabled ? 0.35 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {excelPath ? (
          <div>
            <div className="text-xs font-mono mb-1" style={{ color: '#4b4e55' }}>xlsx</div>
            <div className="text-xs font-mono truncate" style={{ color: '#9fa5a9' }}>{fileName}</div>
            <div className="text-xs font-mono mt-1" style={{ color: '#343d41' }}>click para cambiar</div>
          </div>
        ) : (
          <div>
            <div className="text-xs font-mono mb-1" style={{ color: '#343d41' }}>.xlsx · .xls · .csv</div>
            <div className="text-xs font-mono" style={{ color: '#4b4e55' }}>
              arrastrar o click
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
