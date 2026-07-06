import { useDroppable } from '@dnd-kit/core'
import type { Estado, TicketConRelaciones } from '../types/database'
import { TicketCard } from './TicketCard'

interface KanbanColumnProps {
  estado: Estado
  titulo: string
  tickets: TicketConRelaciones[]
}

export function KanbanColumn({ estado, titulo, tickets }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: estado })

  return (
    <div ref={setNodeRef} className={`kanban-column ${isOver ? 'kanban-column--over' : ''}`}>
      <div className="kanban-column__header">
        <h2>{titulo}</h2>
        <span className="kanban-column__count">{tickets.length}</span>
      </div>
      <div className="kanban-column__body">
        {tickets.map((ticket) => (
          <TicketCard key={ticket.id} ticket={ticket} />
        ))}
        {tickets.length === 0 && <p className="kanban-column__vacio">Sin solicitudes</p>}
      </div>
    </div>
  )
}
