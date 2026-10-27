import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  abierto: boolean
  titulo: string
  descripcion: string
  textoConfirmar?: string
  procesando?: boolean
  // 'peligro' (eliminar, revocar) pinta el botón en rojo; 'normal' usa el
  // color principal para confirmaciones que no destruyen nada.
  tono?: 'peligro' | 'normal'
  onConfirmar: () => void
  onCancelar: () => void
}

export function ConfirmDialog({
  abierto,
  titulo,
  descripcion,
  textoConfirmar = 'Confirmar',
  procesando = false,
  tono = 'peligro',
  onConfirmar,
  onCancelar,
}: ConfirmDialogProps) {
  const cancelarRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!abierto) return
    cancelarRef.current?.focus()

    // En captura y sin propagar: Escape cierra solo este diálogo, no el
    // modal de detalle que pueda estar debajo.
    function cerrarConEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (!procesando) onCancelar()
    }

    document.addEventListener('keydown', cerrarConEscape, true)
    return () => document.removeEventListener('keydown', cerrarConEscape, true)
  }, [abierto, onCancelar, procesando])

  if (!abierto) return null

  return (
    <div className="modal-overlay modal-overlay--confirmacion" onMouseDown={() => !procesando && onCancelar()}>
      <div
        className={`confirm-dialog confirm-dialog--${tono}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-titulo"
        aria-describedby="confirm-dialog-descripcion"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog__icono" aria-hidden="true">{tono === 'peligro' ? '!' : '?'}</div>
        <h2 id="confirm-dialog-titulo">{titulo}</h2>
        <p id="confirm-dialog-descripcion">{descripcion}</p>
        <div className="confirm-dialog__acciones">
          <button ref={cancelarRef} type="button" className="confirm-dialog__cancelar" onClick={onCancelar} disabled={procesando}>
            Cancelar
          </button>
          <button type="button" className="confirm-dialog__confirmar" onClick={onConfirmar} disabled={procesando}>
            {procesando ? 'Procesando...' : textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  )
}
