import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { notificarRechazo } from '../lib/notificaciones'
import { TICKET_SELECT } from '../lib/ticket'
import type { TicketConRelaciones } from '../types/database'

interface RechazarSolicitudProps {
  ticket: TicketConRelaciones
  onRechazado: (ticket: TicketConRelaciones) => void
  onCancelar: () => void
}

// El equipo del área rechaza una solicitud que no va a atender. El motivo le
// llega a quien la pidió (campanita y correo) y la tarea sale del tablero.
export function RechazarSolicitud({ ticket, onRechazado, onCancelar }: RechazarSolicitudProps) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function rechazar() {
    if (!motivo.trim()) {
      setError('Cuéntale a quien la pidió por qué no se va a atender.')
      return
    }
    setEnviando(true)
    setError(null)
    const { error: errorRechazo } = await supabase.rpc('rechazar_ticket', {
      p_ticket_id: ticket.id,
      p_motivo: motivo,
    })
    if (errorRechazo) {
      console.error('No se pudo rechazar la solicitud:', errorRechazo.message)
      setEnviando(false)
      setError(`No se pudo rechazar la solicitud: ${errorRechazo.message}`)
      return
    }
    void notificarRechazo(ticket.id)
    const { data } = await supabase.from('tickets').select(TICKET_SELECT).eq('id', ticket.id).single()
    setEnviando(false)
    onRechazado((data as unknown as TicketConRelaciones | null) ?? {
      ...ticket,
      estado: 'rechazado',
      motivo_rechazo: motivo.trim(),
    })
  }

  return (
    <section className="aprobacion aprobacion--rechazo" aria-labelledby="rechazo-titulo">
      <div className="aprobacion__encabezado">
        <span className="aprobacion__icono" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 9l-6 6M9 9l6 6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </span>
        <div>
          <h3 id="rechazo-titulo">Rechazar la solicitud #{ticket.numero}</h3>
          <p>Sale del tablero y no se puede deshacer. Quien la pidió recibe el motivo por la campanita y por correo.</p>
        </div>
      </div>

      <div className="aprobacion__rechazo">
        <label htmlFor="rechazo-motivo">¿Por qué no se va a atender?</label>
        <textarea
          id="rechazo-motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          maxLength={4000}
          spellCheck
          lang="es"
          autoFocus
          placeholder="Ej.: no le corresponde a esta área, está duplicada con #120, falta información…"
        />
        {error && <p className="auth-error">{error}</p>}
        <div className="aprobacion__acciones">
          <button type="button" className="aprobacion__boton-cancelar" onClick={onCancelar} disabled={enviando}>
            Cancelar
          </button>
          <button type="button" className="aprobacion__boton-rechazar" onClick={() => void rechazar()} disabled={enviando || !motivo.trim()}>
            {enviando ? 'Rechazando...' : 'Rechazar solicitud'}
          </button>
        </div>
      </div>
    </section>
  )
}
