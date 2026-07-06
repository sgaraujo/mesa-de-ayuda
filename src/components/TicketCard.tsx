import { useDraggable } from '@dnd-kit/core'
import type { TicketConRelaciones } from '../types/database'

const PRIORIDAD_LABEL: Record<string, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
}

export function TicketCard({ ticket }: { ticket: TicketConRelaciones }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: ticket.id,
  })

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, opacity: isDragging ? 0.6 : 1 }
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`ticket-card ticket-card--${ticket.prioridad}`}
    >
      <div className="ticket-card__header">
        <span className="ticket-card__prioridad">{PRIORIDAD_LABEL[ticket.prioridad]}</span>
        {ticket.area && <span className="ticket-card__area">{ticket.area.nombre}</span>}
      </div>
      <h3>{ticket.titulo}</h3>
      <p>{ticket.descripcion}</p>
      <div className="ticket-card__footer">
        <span>{ticket.empresa_solicitante}</span>
        <span>{ticket.asignado ? ticket.asignado.full_name ?? ticket.asignado.email : 'Bandeja general'}</span>
      </div>
    </div>
  )
}
