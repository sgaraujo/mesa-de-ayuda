import { useDraggable } from '@dnd-kit/core'
import { nombresAsignados } from '../lib/ticket'
import type { TicketConRelaciones } from '../types/database'

const PRIORIDAD_LABEL: Record<string, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
}

function formatearFechaCorta(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function formatearTiempo(horas: number): string {
  const minutosTotales = Math.round(horas * 60)
  const horasEnteras = Math.floor(minutosTotales / 60)
  const minutos = minutosTotales % 60
  return [horasEnteras ? `${horasEnteras}h` : '', minutos ? `${minutos}min` : ''].filter(Boolean).join(' ') || '0min'
}

interface TicketCardProps {
  ticket: TicketConRelaciones
  onClick?: () => void
  puedeArrastrar?: boolean
}

export function TicketCard({ ticket, onClick, puedeArrastrar = true }: TicketCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: ticket.id,
    disabled: !puedeArrastrar,
  })

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, opacity: isDragging ? 0.6 : 1 }
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(puedeArrastrar ? listeners : {})}
      {...(puedeArrastrar ? attributes : {})}
      onClick={onClick}
      className={`ticket-card ticket-card--${ticket.prioridad}`}
    >
      <div className="ticket-card__header">
        <span className="ticket-card__prioridad">
          {PRIORIDAD_LABEL[ticket.prioridad]}
          {ticket.es_grupal && <span className="badge badge--grupal">Grupo</span>}
        </span>
        <span className="ticket-card__area">
          {[ticket.proyecto?.nombre, ticket.area?.nombre].filter(Boolean).join(' · ')}
        </span>
      </div>
      <h3>{ticket.titulo}</h3>
      <p>{ticket.descripcion}</p>
      {(ticket.fecha_requerida || ticket.tiempo_propuesto_horas || ticket.tiempo_ejecutado_horas) && (
        <div className="ticket-card__tiempos">
          {ticket.fecha_requerida && <span>Para: {formatearFechaCorta(ticket.fecha_requerida)}</span>}
          {ticket.tiempo_propuesto_horas != null && <span>Propuesto: {formatearTiempo(ticket.tiempo_propuesto_horas)}</span>}
          {ticket.tiempo_ejecutado_horas != null && <span>Ejecutado: {formatearTiempo(ticket.tiempo_ejecutado_horas)}</span>}
        </div>
      )}
      <div className="ticket-card__footer">
        <span>{ticket.empresa_solicitante}</span>
        <span>{nombresAsignados(ticket).join(', ') || 'Bandeja general'}</span>
      </div>
    </div>
  )
}
