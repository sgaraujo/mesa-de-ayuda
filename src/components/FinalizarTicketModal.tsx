import { useState, type FormEvent } from 'react'
import { separarTiempo, combinarTiempo } from '../lib/tiempo'
import { SugerenciasTexto } from './SugerenciasTexto'
import { CampoMenciones } from './CampoMenciones'
import { mencionadosEnTexto, nombreDe } from '../lib/menciones'
import type { UsuarioActivo } from '../hooks/useUsuariosActivos'

interface FinalizarTicketModalProps {
  tituloTicket: string
  tiempoEjecutadoHoras: number | null
  guardando: boolean
  error: string | null
  // mencionados: personas etiquetadas con @ que siguen escritas en la nota.
  onConfirmar: (nota: string, tiempoEjecutadoHoras: number | null, mencionados: UsuarioActivo[]) => void
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
  const [mencionados, setMencionados] = useState<UsuarioActivo[]>([])
  const [horasIniciales, minutosIniciales] = separarTiempo(tiempoEjecutadoHoras)
  const [horas, setHoras] = useState(horasIniciales)
  const [minutos, setMinutos] = useState(minutosIniciales)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onConfirmar(nota.trim(), combinarTiempo(horas, minutos), mencionadosEnTexto(nota, mencionados))
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
          <label htmlFor="nota-finalizacion">
            Nota para el solicitante <small>Opcional · usa @ para etiquetar a alguien</small>
          </label>
          <div className="comentarios__caja">
          <CampoMenciones
            id="nota-finalizacion"
            valor={nota}
            onCambiar={setNota}
            mencionados={mencionados}
            onCambiarMencionados={setMencionados}
            rows={4}
            spellCheck
            lang="es"
            placeholder="ej. Quedó lista. @Ana López revisa el informe final, por favor."
          />
          </div>
          {mencionadosEnTexto(nota, mencionados).length > 0 && (
            <p className="finalizar__mencionados">
              Se notificará a {mencionadosEnTexto(nota, mencionados).map(nombreDe).join(', ')}.
              La nota también quedará como comentario de la tarea.
            </p>
          )}
          <SugerenciasTexto texto={nota} onCambiar={setNota} />
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" disabled={guardando}>
            {guardando ? 'Finalizando...' : 'Finalizar tarea'}
          </button>
        </form>
      </div>
    </div>
  )
}
