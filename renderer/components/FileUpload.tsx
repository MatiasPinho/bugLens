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

      // In Electron, dragged files expose their path via webkitRelativePath or via the File object
      // The actual system path is available as file.path in Electron
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
      <div className="text-sm font-medium text-gray-300 mb-3">Archivo Excel de bugs</div>

      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onClick={handleBrowse}
        className={`
          border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all
          ${dragOver ? 'border-indigo-500 bg-indigo-950' : 'border-gray-700 hover:border-gray-600'}
          ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
          ${excelPath ? 'border-green-700 bg-green-950/30' : ''}
        `}
      >
        {excelPath ? (
          <div>
            <div className="text-2xl mb-1">📊</div>
            <div className="text-sm font-medium text-green-300 truncate max-w-full">{fileName}</div>
            <div className="text-xs text-gray-500 mt-1">Click para cambiar</div>
          </div>
        ) : (
          <div>
            <div className="text-2xl mb-1">📂</div>
            <div className="text-sm text-gray-400">
              Arrastrá el Excel aquí<br />
              <span className="text-gray-600">o click para explorar</span>
            </div>
            <div className="text-xs text-gray-600 mt-2">.xlsx · .xls · .csv</div>
          </div>
        )}
      </div>
    </div>
  )
}
