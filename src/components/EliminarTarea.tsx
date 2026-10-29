import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { notificarEliminacion } from '../lib/notificaciones'
import type { TicketConRelaciones } from '../types/database'

interface EliminarTareaProps {
  ticket: TicketConRelaciones
  // Nombres de quienes reciben el aviso (quien la creó y sus responsables).
  involucrados: string[]
  onEliminado: (ticketId: string) => void
  onCancelar: () => void
}

// El líder elimina una tarea en la que hay otras personas: el motivo les llega
// por la campanita y por correo (migración 0054).
export function EliminarTarea({ ticket, involucrados, onEliminado, onCancelar }: EliminarTareaProps) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function eliminar() {
    if (!motivo.trim()) {
      setError('Cuéntales por qué se elimina la tarea.')
      return
    }
    setEnviando(true)
    setError(null)
    const { data: eliminadoId, error: errorEliminar } = await supabase.rpc('eliminar_ticket', {
      p_ticket_id: ticket.id,
      p_motivo: motivo,
    })
    if (errorEliminar) {
      console.error('No se pudo eliminar la tarea:', errorEliminar.message)
      setEnviando(false)
      setError(`No se pudo eliminar la tarea: ${errorEliminar.message}`)
      return
    }
    if (eliminadoId) void notificarEliminacion(eliminadoId as string)
    onEliminado(ticket.id)
  }

  return (
    <section className="aprobacion aprobacion--rechazo" aria-labelledby="eliminar-titulo">
      <div className="aprobacion__encabezado">
        <span className="aprobacion__icono" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
          </svg>
        </span>
        <div>
          <h3 id="eliminar-titulo">Eliminar la tarea #{ticket.numero}</h3>
          <p>
            Se borra de forma permanente y no se puede deshacer. {involucrados.join(', ')} recibirá el motivo por la
            campanita y por correo.
          </p>
        </div>
      </div>

      <div className="aprobacion__rechazo">
        <label htmlFor="eliminar-motivo">¿Por qué se elimina?</label>
        <textarea
          id="eliminar-motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          maxLength={4000}
          spellCheck
          lang="es"
          autoFocus
          placeholder="Ej.: está duplicada con #120, se creó por error, ya no se necesita…"
        />
        {error && <p className="auth-error">{error}</p>}
        <div className="aprobacion__acciones">
          <button type="button" className="aprobacion__boton-cancelar" onClick={onCancelar} disabled={enviando}>
            Cancelar
          </button>
          <button type="button" className="aprobacion__boton-rechazar" onClick={() => void eliminar()} disabled={enviando || !motivo.trim()}>
            {enviando ? 'Eliminando...' : 'Eliminar tarea'}
          </button>
        </div>
      </div>
    </section>
  )
}
