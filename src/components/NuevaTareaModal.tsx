import { useAuth } from '../context/AuthContext'
import { TicketForm } from './TicketForm'

interface NuevaTareaModalProps {
  onClose: () => void
  onCreado: () => void
}

export function NuevaTareaModal({ onClose, onCreado }: NuevaTareaModalProps) {
  const { profile } = useAuth()

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-panel__header">
          <h2>Nueva tarea</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <TicketForm asignadoAPorDefecto={profile?.id} onCreado={onCreado} />
      </div>
    </div>
  )
}
