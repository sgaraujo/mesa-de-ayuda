import { useEffect, useMemo, useState } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useAreas } from '../hooks/useAreas'
import { KanbanColumn } from '../components/KanbanColumn'
import { TicketDetalleModal } from '../components/TicketDetalleModal'
import { NuevaTareaModal } from '../components/NuevaTareaModal'
import type { Estado, TicketConRelaciones } from '../types/database'

const COLUMNAS: { estado: Estado; titulo: string }[] = [
  { estado: 'pendiente', titulo: 'Pendiente' },
  { estado: 'en_curso', titulo: 'En curso' },
  { estado: 'finalizado', titulo: 'Finalizado' },
]

const TICKET_SELECT = `
  *,
  solicitante:profiles!tickets_solicitante_id_fkey(id, full_name, email),
  asignado:profiles!tickets_asignado_a_fkey(id, full_name, email),
  area:areas(id, nombre),
  proyecto:proyectos(id, nombre)
`

type FiltroAsignacion = 'todos' | 'mios' | 'bandeja_general'

export function BoardPage() {
  const { profile } = useAuth()
  const { areas } = useAreas()
  const [tickets, setTickets] = useState<TicketConRelaciones[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroArea, setFiltroArea] = useState('')
  const [filtroAsignacion, setFiltroAsignacion] = useState<FiltroAsignacion>('todos')
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
    return tickets.filter((t) => {
      if (filtroArea && t.area_id !== filtroArea) return false
      if (filtroAsignacion === 'mios' && t.asignado_a !== profile?.id) return false
      if (filtroAsignacion === 'bandeja_general' && t.asignado_a !== null) return false
      return true
    })
  }, [tickets, filtroArea, filtroAsignacion, profile])

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return

    const ticketId = String(active.id)
    const nuevoEstado = over.id as Estado
    const ticket = tickets.find((t) => t.id === ticketId)
    if (!ticket || ticket.estado === nuevoEstado) return

    setTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? { ...t, estado: nuevoEstado } : t)),
    )

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
          <select
            value={filtroAsignacion}
            onChange={(e) => setFiltroAsignacion(e.target.value as FiltroAsignacion)}
          >
            <option value="todos">Todas las solicitudes</option>
            <option value="mios">Asignadas a mí</option>
            <option value="bandeja_general">Bandeja general</option>
          </select>
          <button type="button" onClick={() => setMostrarNuevaTarea(true)}>
            + Nueva tarea
          </button>
        </div>
      </div>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="kanban-board">
          {COLUMNAS.map((columna) => (
            <KanbanColumn
              key={columna.estado}
              estado={columna.estado}
              titulo={columna.titulo}
              tickets={ticketsFiltrados.filter((t) => t.estado === columna.estado)}
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
