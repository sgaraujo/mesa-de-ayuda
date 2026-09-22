import { useState, type FormEvent } from 'react'
import { separarTiempo, combinarTiempo } from '../lib/tiempo'

interface FinalizarTicketModalProps {
  tituloTicket: string
  tiempoEjecutadoHoras: number | null
  guardando: boolean
  error: string | null
  onConfirmar: (nota: string, tiempoEjecutadoHoras: number | null) => void
  onCancelar: () => void
}

export function FinalizarTicketModal({
  tituloTicket,
  tiempoEjecutadoHoras,
  guardando,
  error,
  onConfirmar,
  onCancelar,
}: FinalizarTicketModalProps) {
  const [nota, setNota] = useState('')
  const [horasIniciales, minutosIniciales] = separarTiempo(tiempoEjecutadoHoras)
  const [horas, setHoras] = useState(horasIniciales)
  const [minutos, setMinutos] = useState(minutosIniciales)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onConfirmar(nota.trim(), combinarTiempo(horas, minutos))
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
          <fieldset>
            <legend>Tiempo ejecutado</legend>
            <input
              type="number"
              min="0"
              step="1"
              value={horas}
              onChange={(e) => setHoras(e.target.value)}
              placeholder="Horas"
              aria-label="Horas ejecutadas"
            />
            <input
              type="number"
              min="0"
              max="59"
              step="1"
              value={minutos}
              onChange={(e) => setMinutos(e.target.value)}
              placeholder="Minutos"
              aria-label="Minutos ejecutados"
            />
          </fieldset>
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
