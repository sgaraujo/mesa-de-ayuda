import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useAreas } from '../hooks/useAreas'
import { useAgentes } from '../hooks/useAgentes'
import { notificarAsignacion, notificarFinalizacion } from '../lib/notificaciones'
import { KanbanColumn, type ColumnaId } from '../components/KanbanColumn'
import { TicketDetalleModal } from '../components/TicketDetalleModal'
import { NuevaTareaModal } from '../components/NuevaTareaModal'
import { FinalizarTicketModal } from '../components/FinalizarTicketModal'
import { estaSinAsignar } from '../lib/ticket'
import type { Estado, TicketConRelaciones } from '../types/database'

const COLUMNAS: { id: ColumnaId; titulo: string }[] = [
  { id: 'tareas', titulo: 'Tareas (sin asignar)' },
  { id: 'pendiente', titulo: 'Pendiente' },
  { id: 'en_curso', titulo: 'En curso' },
  { id: 'finalizado', titulo: 'Finalizado' },
]

const COLUMNAS_SOLICITANTE: { id: ColumnaId; titulo: string }[] = [
  { id: 'pendiente', titulo: 'Pendientes' },
  { id: 'finalizado', titulo: 'Finalizadas' },
]

const DIAS_FINALIZADOS_EN_TABLERO = 30

const TICKET_SELECT = `
  *,
  solicitante:profiles!tickets_solicitante_id_fkey(id, full_name, email),
  asignado:profiles!tickets_asignado_a_fkey(id, full_name, email),
  area:areas(id, nombre),
  proyecto:proyectos(id, nombre),
  asignados:ticket_asignados(profile:profiles(id, full_name, email))
`

const BOARD_CHANNEL = 'ticket-board'

export function BoardPage() {
  const { profile } = useAuth()
  const esSolicitante = profile?.role === 'solicitante'
  const esAdmin = profile?.role === 'admin'
  const { areas } = useAreas()
  const { agentes } = useAgentes()
  const [tickets, setTickets] = useState<TicketConRelaciones[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroArea, setFiltroArea] = useState('')
  const [filtroAgente, setFiltroAgente] = useState('')
  const [vistaHistorial, setVistaHistorial] = useState(false)
  const [ticketSeleccionado, setTicketSeleccionado] = useState<TicketConRelaciones | null>(null)
  const [mostrarNuevaTarea, setMostrarNuevaTarea] = useState(false)
  const [ticketAFinalizar, setTicketAFinalizar] = useState<{
    ticketId: string
    titulo: string
    cambios: Record<string, unknown>
    estadoAnterior: Estado
  } | null>(null)
  const [finalizando, setFinalizando] = useState(false)
  const [errorFinalizar, setErrorFinalizar] = useState<string | null>(null)
  const boardChannel = useRef<RealtimeChannel | null>(null)
  const idsPendientes = useRef<Set<string>>(new Set())
  const recargaPendiente = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  const cargarTickets = useCallback(async (mostrarCarga = false) => {
    if (mostrarCarga) setLoading(true)
    const { data } = await supabase
      .from('tickets')
      .select(TICKET_SELECT)
      .order('created_at', { ascending: false })
    setTickets((data as unknown as TicketConRelaciones[]) ?? [])
    setLoading(false)
  }, [])

  const notificarCambio = useCallback(async (ticketId?: string) => {
    await boardChannel.current?.send({
      type: 'broadcast',
      event: 'tickets_changed',
      payload: { ticketId },
    })
  }, [])

  // Solo se refresca el/los tickets que realmente cambiaron (no todo el
  // tablero), agrupando en una sola consulta los que lleguen en la misma
  // ráfaga. Antes cualquier cambio de cualquier persona recargaba la lista
  // completa, lo que hacía que el tablero pareciera "recargarse" todo el
  // tiempo.
  const programarActualizacion = useCallback((ticketId?: string) => {
    if (!ticketId) return
    idsPendientes.current.add(ticketId)
    if (recargaPendiente.current) clearTimeout(recargaPendiente.current)
    recargaPendiente.current = setTimeout(async () => {
      const ids = Array.from(idsPendientes.current)
      idsPendientes.current.clear()
      recargaPendiente.current = null
      if (ids.length === 0) return

      const { data } = await supabase.from('tickets').select(TICKET_SELECT).in('id', ids)
      const actualizados = new Map(
        ((data as unknown as TicketConRelaciones[]) ?? []).map((t) => [t.id, t]),
      )

      setTickets((prev) => {
        const siguen = prev
          .filter((t) => !ids.includes(t.id) || actualizados.has(t.id))
          .map((t) => actualizados.get(t.id) ?? t)
        const nuevos = ids
          .filter((id) => !prev.some((t) => t.id === id) && actualizados.has(id))
          .map((id) => actualizados.get(id)!)
        return [...nuevos, ...siguen]
      })
    }, 400)
  }, [])

  useEffect(() => {
    void cargarTickets(true)

    const channel = supabase
      .channel(BOARD_CHANNEL)
      .on('broadcast', { event: 'tickets_changed' }, ({ payload }) => {
        programarActualizacion((payload as { ticketId?: string } | undefined)?.ticketId)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, (payload) => {
        const fila = (payload.new ?? payload.old) as { id?: string } | null
        programarActualizacion(fila?.id)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_asignados' }, (payload) => {
        const fila = (payload.new ?? payload.old) as { ticket_id?: string } | null
        programarActualizacion(fila?.ticket_id)
      })
      .subscribe()
    boardChannel.current = channel

    return () => {
      if (recargaPendiente.current) clearTimeout(recargaPendiente.current)
      idsPendientes.current.clear()
      boardChannel.current = null
      void supabase.removeChannel(channel)
    }
  }, [cargarTickets, programarActualizacion])

  const ticketsFiltrados = useMemo(() => {
    const limiteFinalizados = Date.now() - DIAS_FINALIZADOS_EN_TABLERO * 24 * 60 * 60 * 1000

    return tickets.filter((t) => {
      if (filtroArea && t.area_id !== filtroArea) return false

      if (filtroAgente === 'sin_asignar' && !estaSinAsignar(t)) return false
      if (
        filtroAgente &&
        filtroAgente !== 'sin_asignar' &&
        t.asignado_a !== filtroAgente &&
        !t.asignados.some((asignado) => asignado.profile.id === filtroAgente)
      ) return false

      const esFinalizadoAntiguo = t.estado === 'finalizado'
        && t.finalizado_at !== null
        && new Date(t.finalizado_at).getTime() < limiteFinalizados

      return vistaHistorial ? esFinalizadoAntiguo : !esFinalizadoAntiguo
    })
  }, [tickets, filtroArea, filtroAgente, vistaHistorial])

  function ticketsParaColumna(id: ColumnaId) {
    if (vistaHistorial) return id === 'finalizado' ? ticketsFiltrados : []
    if (esSolicitante) {
      if (id === 'pendiente') return ticketsFiltrados.filter((t) => t.estado !== 'finalizado')
      if (id === 'finalizado') return ticketsFiltrados.filter((t) => t.estado === 'finalizado')
      return []
    }
    if (id === 'tareas') return ticketsFiltrados.filter((t) => estaSinAsignar(t))
    return ticketsFiltrados.filter((t) => !estaSinAsignar(t) && t.estado === id)
  }

  async function handleDragEnd(event: DragEndEvent) {
    if (esSolicitante) return
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

      if (nuevoEstado === 'finalizado') {
        setErrorFinalizar(null)
        setTicketAFinalizar({
          ticketId,
          titulo: ticket.titulo,
          cambios: { estado: nuevoEstado, finalizado_at: new Date().toISOString() },
          estadoAnterior: ticket.estado,
        })
        return
      }

      setTickets((prev) => prev.map((t) => (
        t.id === ticketId ? { ...t, estado: nuevoEstado, finalizado_at: null } : t
      )))
      await supabase
        .from('tickets')
        .update({ estado: nuevoEstado, finalizado_at: null })
        .eq('id', ticketId)
      await supabase.from('ticket_status_history').insert({
        ticket_id: ticketId,
        estado: nuevoEstado,
        changed_by: profile?.id ?? null,
      })
      await notificarCambio(ticketId)
      return
    }

    // Soltar en "Tareas" devuelve el ticket a la bandeja general (lo desasigna).
    if (destino === 'tareas') {
      if (ticket.asignado_a === null) return
      setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, asignado_a: null } : t)))
      await supabase.from('tickets').update({ asignado_a: null }).eq('id', ticketId)
      await notificarCambio(ticketId)
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

    if (nuevoEstado === 'finalizado') {
      setErrorFinalizar(null)
      setTicketAFinalizar({ ticketId, titulo: ticket.titulo, cambios, estadoAnterior: ticket.estado })
      return
    }

    setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, ...cambios } : t)))
    await supabase.from('tickets').update(cambios).eq('id', ticketId)

    if (estabaSinAsignar && profile?.id) void notificarAsignacion(ticketId, [profile.id])

    if (ticket.estado !== nuevoEstado) {
      await supabase.from('ticket_status_history').insert({
        ticket_id: ticketId,
        estado: nuevoEstado,
        changed_by: profile?.id ?? null,
      })
    }
    await notificarCambio(ticketId)
  }

  async function confirmarFinalizacion(nota: string) {
    if (!ticketAFinalizar) return
    const { ticketId, cambios, estadoAnterior } = ticketAFinalizar
    setFinalizando(true)
    setErrorFinalizar(null)

    const cambiosFinales = { ...cambios, nota_finalizacion: nota || null }
    const { error } = await supabase.from('tickets').update(cambiosFinales).eq('id', ticketId)

    if (error) {
      setFinalizando(false)
      setErrorFinalizar('No se pudo finalizar la tarea. Intenta de nuevo.')
      return
    }

    setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, ...cambiosFinales } : t)))

    if (cambios.asignado_a && profile?.id) void notificarAsignacion(ticketId, [profile.id])
    if (estadoAnterior !== 'finalizado') {
      await supabase.from('ticket_status_history').insert({
        ticket_id: ticketId,
        estado: 'finalizado',
        changed_by: profile?.id ?? null,
      })
    }
    void notificarFinalizacion(ticketId)
    await notificarCambio(ticketId)

    setFinalizando(false)
    setTicketAFinalizar(null)
  }

  if (loading) return <div className="pantalla-carga">Cargando tablero...</div>

  return (
    <div className="board-page">
      <div className="board-page__toolbar">
        <div>
          <h1>{vistaHistorial ? 'Historial de finalizadas' : esSolicitante ? 'Mis solicitudes' : 'Tablero'}</h1>
          {vistaHistorial && <p className="board-page__subtitulo">Tareas finalizadas hace más de 30 días.</p>}
        </div>
        <div className="board-page__filtros">
          {!esSolicitante && (
            <select value={filtroArea} onChange={(e) => setFiltroArea(e.target.value)}>
              <option value="">Todas las áreas</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.nombre}
                </option>
              ))}
            </select>
          )}
          {esAdmin && (
            <select value={filtroAgente} onChange={(e) => setFiltroAgente(e.target.value)} aria-label="Filtrar por agente">
              <option value="">Todas las personas</option>
              <option value="sin_asignar">Sin asignar</option>
              {agentes.map((agente) => (
                <option key={agente.id} value={agente.id}>
                  {agente.full_name ?? agente.email} ({agente.role === 'admin' ? 'Admin' : 'Agente'})
                </option>
              ))}
            </select>
          )}
          {esAdmin && (
            <select value={vistaHistorial ? 'historial' : 'actual'} onChange={(e) => setVistaHistorial(e.target.value === 'historial')} aria-label="Cambiar vista del tablero">
              <option value="actual">Tablero actual</option>
              <option value="historial">Historial (+30 días)</option>
            </select>
          )}
          <button type="button" onClick={() => setMostrarNuevaTarea(true)}>
            + Nueva tarea
          </button>
        </div>
      </div>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className={`kanban-board ${vistaHistorial ? 'kanban-board--1' : esSolicitante ? 'kanban-board--2' : 'kanban-board--4'}`}>
          {(vistaHistorial ? [{ id: 'finalizado' as const, titulo: 'Finalizadas archivadas' }] : esSolicitante ? COLUMNAS_SOLICITANTE : COLUMNAS).map((columna) => (
            <KanbanColumn
              key={columna.id}
              id={columna.id}
              titulo={columna.titulo}
              tickets={ticketsParaColumna(columna.id)}
              puedeArrastrar={!esSolicitante && !vistaHistorial}
              onTicketClick={setTicketSeleccionado}
            />
          ))}
        </div>
      </DndContext>

      {ticketSeleccionado && (
        <TicketDetalleModal
          ticket={ticketSeleccionado}
          puedeEditarTiempos={profile?.role === 'agente' || profile?.role === 'admin'}
          puedeEliminar={esAdmin}
          onClose={() => setTicketSeleccionado(null)}
          onGuardado={(actualizado) => {
            setTickets((prev) => prev.map((t) => (t.id === actualizado.id ? { ...t, ...actualizado } : t)))
            setTicketSeleccionado(null)
            void notificarCambio(actualizado.id)
          }}
          onEliminado={(ticketId) => {
            setTickets((prev) => prev.filter((t) => t.id !== ticketId))
            setTicketSeleccionado(null)
            void notificarCambio(ticketId)
          }}
        />
      )}

      {mostrarNuevaTarea && (
        <NuevaTareaModal
          onClose={() => setMostrarNuevaTarea(false)}
          onCreado={() => {
            setMostrarNuevaTarea(false)
            void cargarTickets()
          }}
        />
      )}

      {ticketAFinalizar && (
        <FinalizarTicketModal
          tituloTicket={ticketAFinalizar.titulo}
          guardando={finalizando}
          error={errorFinalizar}
          onConfirmar={(nota) => void confirmarFinalizacion(nota)}
          onCancelar={() => {
            if (finalizando) return
            setTicketAFinalizar(null)
            setErrorFinalizar(null)
          }}
        />
      )}
    </div>
  )
}
