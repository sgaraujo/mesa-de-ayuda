import { useDroppable } from '@dnd-kit/core'
import type { TicketConRelaciones } from '../types/database'
import { TicketCard } from './TicketCard'

export type ColumnaId = 'tareas' | 'pendiente' | 'en_curso' | 'finalizado'

interface KanbanColumnProps {
  id: ColumnaId
  titulo: string
  tickets: TicketConRelaciones[]
  onTicketClick?: (ticket: TicketConRelaciones) => void
  puedeArrastrar?: boolean
}

export function KanbanColumn({ id, titulo, tickets, onTicketClick, puedeArrastrar = true }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={`kanban-column kanban-column--${id} ${isOver ? 'kanban-column--over' : ''}`}
    >
      <div className="kanban-column__header">
        <h2>{titulo}</h2>
        <span className="kanban-column__count">{tickets.length}</span>
      </div>
      <div className="kanban-column__body">
        {tickets.map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            puedeArrastrar={puedeArrastrar}
            onClick={() => onTicketClick?.(ticket)}
          />
        ))}
        {tickets.length === 0 && <p className="kanban-column__vacio">Sin solicitudes</p>}
      </div>
    </div>
  )
}
