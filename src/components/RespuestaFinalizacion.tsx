import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { aprobacionAutomaticaAt, HORAS_APROBACION_AUTOMATICA, TICKET_SELECT } from '../lib/ticket'
import type { TicketConRelaciones } from '../types/database'

interface RespuestaFinalizacionProps {
  ticket: TicketConRelaciones
  onRespondido: (ticket: TicketConRelaciones) => void
}

// Lo ve solo quien pidió la tarea mientras está finalizada y por aprobar:
// la aprueba o la rechaza con un motivo, y entonces vuelve a Pendiente.
export function RespuestaFinalizacion({ ticket, onRespondido }: RespuestaFinalizacionProps) {
  const [rechazando, setRechazando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const automaticaAt = aprobacionAutomaticaAt(ticket)

  async function responder(aprobar: boolean) {
    if (!aprobar && !motivo.trim()) {
      setError('Cuéntale al equipo qué falta o qué no quedó bien.')
      return
    }
    setEnviando(true)
    setError(null)
    const { error: errorRespuesta } = await supabase.rpc('responder_finalizacion', {
      p_ticket_id: ticket.id,
      p_aprobar: aprobar,
      p_motivo: aprobar ? null : motivo,
    })
    if (errorRespuesta) {
      console.error('No se pudo responder la finalización:', errorRespuesta.message)
      setEnviando(false)
      // El motivo se muestra (app interna): sin él no hay forma de saber qué falló.
      setError(`No se pudo registrar tu respuesta: ${errorRespuesta.message}`)
      return
    }
    const { data } = await supabase.from('tickets').select(TICKET_SELECT).eq('id', ticket.id).single()
    setEnviando(false)
    onRespondido((data as unknown as TicketConRelaciones | null) ?? {
      ...ticket,
      aprobacion: aprobar ? 'aprobada' : 'rechazada',
      estado: aprobar ? ticket.estado : 'pendiente',
    })
  }

  return (
    <section className="aprobacion" aria-labelledby="aprobacion-titulo">
      <div className="aprobacion__encabezado">
        <span className="aprobacion__icono" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </span>
        <div>
          <h3 id="aprobacion-titulo">El equipo marcó tu solicitud como finalizada</h3>
          <p>¿Quedó resuelta? Apruébala para cerrarla, o recházala y volverá a Pendiente para que la retomen.</p>
          <p>
            Si no respondes, se aprobará automáticamente
            {automaticaAt
              ? ` a las ${automaticaAt.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}`
              : ` ${HORAS_APROBACION_AUTOMATICA} horas después de finalizada`}
            .
          </p>
        </div>
      </div>

      {rechazando ? (
        <div className="aprobacion__rechazo">
          <label htmlFor="aprobacion-motivo">¿Qué falta o qué no quedó bien?</label>
          <textarea
            id="aprobacion-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            maxLength={4000}
            spellCheck
            lang="es"
            autoFocus
            placeholder="El motivo queda en los comentarios y le llega al equipo."
          />
          {error && <p className="auth-error">{error}</p>}
          <div className="aprobacion__acciones">
            <button type="button" className="aprobacion__boton-cancelar" onClick={() => { setRechazando(false); setError(null) }} disabled={enviando}>
              Cancelar
            </button>
            <button type="button" className="aprobacion__boton-rechazar" onClick={() => void responder(false)} disabled={enviando || !motivo.trim()}>
              {enviando ? 'Enviando...' : 'Rechazar y devolver a Pendiente'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {error && <p className="auth-error">{error}</p>}
          <div className="aprobacion__acciones">
            <button type="button" className="aprobacion__boton-rechazar aprobacion__boton-rechazar--suave" onClick={() => setRechazando(true)} disabled={enviando}>
              Rechazar
            </button>
            <button type="button" className="aprobacion__boton-aprobar" onClick={() => void responder(true)} disabled={enviando}>
              {enviando ? 'Enviando...' : 'Aprobar'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
