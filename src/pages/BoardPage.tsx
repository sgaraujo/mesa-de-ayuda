import { useEffect, useMemo, useState } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useAreas } from '../hooks/useAreas'
import { KanbanColumn, type ColumnaId } from '../components/KanbanColumn'
import { TicketDetalleModal } from '../components/TicketDetalleModal'
import { NuevaTareaModal } from '../components/NuevaTareaModal'
import { estaSinAsignar } from '../lib/ticket'
import type { Estado, TicketConRelaciones } from '../types/database'

const COLUMNAS: { id: ColumnaId; titulo: string }[] = [
  { id: 'tareas', titulo: 'Tareas (sin asignar)' },
  { id: 'pendiente', titulo: 'Pendiente' },
  { id: 'en_curso', titulo: 'En curso' },
  { id: 'finalizado', titulo: 'Finalizado' },
]

const TICKET_SELECT = `
  *,
  solicitante:profiles!tickets_solicitante_id_fkey(id, full_name, email),
  asignado:profiles!tickets_asignado_a_fkey(id, full_name, email),
  area:areas(id, nombre),
  proyecto:proyectos(id, nombre),
  asignados:ticket_asignados(profile:profiles(id, full_name, email))
`

export function BoardPage() {
  const { profile } = useAuth()
  const { areas } = useAreas()
  const [tickets, setTickets] = useState<TicketConRelaciones[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroArea, setFiltroArea] = useState('')
  const [ticketSeleccionado, setTicketSeleccionado] = useState<TicketConRelaciones | null>(null)
  const [mostrarNuevaTarea, setMostrarNuevaTarea] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  async function cargarTickets() {
    setLoading(true)
    const { data } = await supabase
      .from('tickets')
      .select(TICKET_SELECT)
      .order('created_at', { ascending: false })
    setTickets((data as unknown as TicketConRelaciones[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    cargarTickets()
  }, [])

  const ticketsFiltrados = useMemo(() => {
    return tickets.filter((t) => !filtroArea || t.area_id === filtroArea)
  }, [tickets, filtroArea])

  function ticketsParaColumna(id: ColumnaId) {
    if (id === 'tareas') return ticketsFiltrados.filter((t) => estaSinAsignar(t))
    return ticketsFiltrados.filter((t) => !estaSinAsignar(t) && t.estado === id)
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return

    const ticketId = String(active.id)
    const destino = over.id as ColumnaId
    const ticket = tickets.find((t) => t.id === ticketId)
    if (!ticket) return

    // Las tareas en grupo no se (des)asignan arrastrando; eso se maneja
    // desde el panel de detalle. Solo se les actualiza el estado.
    if (ticket.es_grupal) {
      if (destino === 'tareas' || ticket.estado === destino) return
      const nuevoEstado = destino as Estado
      setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, estado: nuevoEstado } : t)))
      await supabase
        .from('tickets')
        .update({
          estado: nuevoEstado,
          finalizado_at: nuevoEstado === 'finalizado' ? new Date().toISOString() : null,
        })
        .eq('id', ticketId)
      await supabase.from('ticket_status_history').insert({
        ticket_id: ticketId,
        estado: nuevoEstado,
        changed_by: profile?.id ?? null,
      })
      return
    }

    // Soltar en "Tareas" devuelve el ticket a la bandeja general (lo desasigna).
    if (destino === 'tareas') {
      if (ticket.asignado_a === null) return
      setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, asignado_a: null } : t)))
      await supabase.from('tickets').update({ asignado_a: null }).eq('id', ticketId)
      return
    }

    const nuevoEstado = destino as Estado
    const estabaSinAsignar = ticket.asignado_a === null

    // Sin cambios reales: ya estaba asignado y en ese mismo estado.
    if (!estabaSinAsignar && ticket.estado === nuevoEstado) return

    const cambios: Record<string, unknown> = {
      estado: nuevoEstado,
      finalizado_at: nuevoEstado === 'finalizado' ? new Date().toISOString() : null,
    }
    // Soltar un ticket de "Tareas" en cualquier columna lo asigna a quien lo tomó.
    if (estabaSinAsignar) cambios.asignado_a = profile?.id ?? null

    setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, ...cambios } : t)))
    await supabase.from('tickets').update(cambios).eq('id', ticketId)

    if (ticket.estado !== nuevoEstado) {
      await supabase.from('ticket_status_history').insert({
        ticket_id: ticketId,
        estado: nuevoEstado,
        changed_by: profile?.id ?? null,
      })
    }
  }

  if (loading) return <div className="pantalla-carga">Cargando tablero...</div>

  return (
    <div className="board-page">
      <div className="board-page__toolbar">
        <h1>Tablero</h1>
        <div className="board-page__filtros">
          <select value={filtroArea} onChange={(e) => setFiltroArea(e.target.value)}>
            <option value="">Todas las áreas</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.nombre}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setMostrarNuevaTarea(true)}>
            + Nueva tarea
          </button>
        </div>
      </div>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="kanban-board kanban-board--4">
          {COLUMNAS.map((columna) => (
            <KanbanColumn
              key={columna.id}
              id={columna.id}
              titulo={columna.titulo}
              tickets={ticketsParaColumna(columna.id)}
              onTicketClick={setTicketSeleccionado}
            />
          ))}
        </div>
      </DndContext>

      {ticketSeleccionado && (
        <TicketDetalleModal
          ticket={ticketSeleccionado}
          puedeEditarTiempos={profile?.role === 'agente' || profile?.role === 'admin'}
          onClose={() => setTicketSeleccionado(null)}
          onGuardado={(actualizado) => {
            setTickets((prev) => prev.map((t) => (t.id === actualizado.id ? { ...t, ...actualizado } : t)))
            setTicketSeleccionado(null)
          }}
        />
      )}

      {mostrarNuevaTarea && (
        <NuevaTareaModal
          onClose={() => setMostrarNuevaTarea(false)}
          onCreado={() => {
            setMostrarNuevaTarea(false)
            cargarTickets()
          }}
        />
      )}
    </div>
  )
}
