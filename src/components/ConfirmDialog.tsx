import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  abierto: boolean
  titulo: string
  descripcion: string
  textoConfirmar?: string
  procesando?: boolean
  onConfirmar: () => void
  onCancelar: () => void
}

export function ConfirmDialog({
  abierto,
  titulo,
  descripcion,
  textoConfirmar = 'Confirmar',
  procesando = false,
  onConfirmar,
  onCancelar,
}: ConfirmDialogProps) {
  const cancelarRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!abierto) return
    cancelarRef.current?.focus()

    function cerrarConEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !procesando) onCancelar()
    }

    document.addEventListener('keydown', cerrarConEscape)
    return () => document.removeEventListener('keydown', cerrarConEscape)
  }, [abierto, onCancelar, procesando])

  if (!abierto) return null

  return (
    <div className="modal-overlay" onMouseDown={() => !procesando && onCancelar()}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-titulo"
        aria-describedby="confirm-dialog-descripcion"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog__icono" aria-hidden="true">!</div>
        <h2 id="confirm-dialog-titulo">{titulo}</h2>
        <p id="confirm-dialog-descripcion">{descripcion}</p>
        <div className="confirm-dialog__acciones">
          <button ref={cancelarRef} type="button" className="confirm-dialog__cancelar" onClick={onCancelar} disabled={procesando}>
            Cancelar
          </button>
          <button type="button" className="confirm-dialog__confirmar" onClick={onConfirmar} disabled={procesando}>
            {procesando ? 'Eliminando...' : textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  )
}
