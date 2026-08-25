import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { TicketForm } from './TicketForm'
import { ConfirmDialog } from './ConfirmDialog'

interface NuevaTareaModalProps {
  onClose: () => void
  onCreado: () => void
}

export function NuevaTareaModal({ onClose, onCreado }: NuevaTareaModalProps) {
  const { profile } = useAuth()
  const [dirty, setDirty] = useState(false)
  const [confirmarDescarte, setConfirmarDescarte] = useState(false)
  const asignadoAPorDefecto = profile?.role === 'agente' || profile?.role === 'admin'
    ? profile.id
    : undefined

  function intentarCerrar() {
    if (dirty) setConfirmarDescarte(true)
    else onClose()
  }

  return (
    <>
      <div className="modal-overlay" onClick={intentarCerrar}>
        <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
          <div className="modal-panel__header">
            <h2>Nueva tarea</h2>
            <button type="button" className="modal-close" onClick={intentarCerrar} aria-label="Cerrar">
              ×
            </button>
          </div>
          <TicketForm asignadoAPorDefecto={asignadoAPorDefecto} onCreado={onCreado} onDirtyChange={setDirty} />
        </div>
      </div>
      <ConfirmDialog
        abierto={confirmarDescarte}
        titulo="Descartar solicitud"
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
