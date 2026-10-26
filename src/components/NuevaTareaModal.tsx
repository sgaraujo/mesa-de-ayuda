import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useArea } from '../context/AreaContext'
import { TicketForm } from './TicketForm'
import { ConfirmDialog } from './ConfirmDialog'

interface NuevaTareaModalProps {
  onClose: () => void
  onCreado: () => void
}

// Mismo armazón que el detalle de la tarea: encabezado, cuerpo desplazable
// y pie fijo con las acciones (el pie lo pone TicketForm).
export function NuevaTareaModal({ onClose, onCreado }: NuevaTareaModalProps) {
  const { profile } = useAuth()
  const { areaActiva } = useArea()
  const [dirty, setDirty] = useState(false)
  const [confirmarDescarte, setConfirmarDescarte] = useState(false)
  const asignadoAPorDefecto = areaActiva?.rol === 'agente' || areaActiva?.rol === 'lider'
    ? profile?.id
    : undefined

  function intentarCerrar() {
    if (dirty) setConfirmarDescarte(true)
    else onClose()
  }

  return (
    <>
      <div
        className="modal-overlay"
        onClick={intentarCerrar}
        onKeyDown={(e) => {
          if (e.key === 'Escape') intentarCerrar()
        }}
      >
        <div
          className="modal-panel modal-panel--nueva-tarea"
          role="dialog"
          aria-modal="true"
          aria-labelledby="nueva-tarea-titulo"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="detalle__header">
            <div className="nueva-tarea__titulo">
              <h2 id="nueva-tarea-titulo">Nueva tarea</h2>
              {areaActiva && <span className="nueva-tarea__area">{areaActiva.nombre}</span>}
            </div>
            <button type="button" className="detalle__boton-icono" onClick={intentarCerrar} aria-label="Cerrar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>
          <TicketForm
            asignadoAPorDefecto={asignadoAPorDefecto}
            onCreado={onCreado}
            onDirtyChange={setDirty}
            onCancelar={intentarCerrar}
          />
        </div>
      </div>
      <ConfirmDialog
        abierto={confirmarDescarte}
        titulo="Descartar tarea"
        descripcion="Tienes texto sin guardar. Si sales ahora, se perderá."
        textoConfirmar="Descartar"
        onCancelar={() => setConfirmarDescarte(false)}
        onConfirmar={() => {
          setConfirmarDescarte(false)
          onClose()
        }}
      />
    </>
  )
}
