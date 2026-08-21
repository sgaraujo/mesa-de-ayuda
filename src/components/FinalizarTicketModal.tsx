import { useState, type FormEvent } from 'react'

interface FinalizarTicketModalProps {
  tituloTicket: string
  guardando: boolean
  error: string | null
  onConfirmar: (nota: string) => void
  onCancelar: () => void
}

export function FinalizarTicketModal({
  tituloTicket,
  guardando,
  error,
  onConfirmar,
  onCancelar,
}: FinalizarTicketModalProps) {
  const [nota, setNota] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onConfirmar(nota.trim())
  }

  return (
    <div className="modal-overlay" onClick={onCancelar}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-panel__header">
          <h2>Finalizar tarea</h2>
          <button type="button" className="modal-close" onClick={onCancelar} aria-label="Cerrar">
            ×
          </button>
        </div>
        <p className="modal-descripcion">
          Vas a marcar <strong>{tituloTicket}</strong> como finalizada. Le llegará un correo al
          solicitante avisándole.
        </p>
        <form onSubmit={handleSubmit} className="ticket-form">
          <label>
            Nota para el solicitante <small>Opcional</small>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={4}
              placeholder="ej. Quedó lista, cualquier ajuste me avisas."
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" disabled={guardando}>
            {guardando ? 'Finalizando...' : 'Finalizar tarea'}
          </button>
        </form>
      </div>
    </div>
  )
}
