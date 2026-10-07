import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useArea } from '../context/AreaContext'
import { useMiembrosArea } from '../hooks/useMiembrosArea'
import { notificarAsignacion, notificarFinalizacion } from '../lib/notificaciones'
import { KanbanColumn, type ColumnaId } from '../components/KanbanColumn'
import { TicketDetalleModal } from '../components/TicketDetalleModal'
import { NuevaTareaModal } from '../components/NuevaTareaModal'
import { FinalizarTicketModal } from '../components/FinalizarTicketModal'
import { coincideBusqueda, estaSinAsignar } from '../lib/ticket'
import type { Estado, TicketConRelaciones } from '../types/database'

const COLUMNAS: { id: ColumnaId; titulo: string }[] = [
  { id: 'tareas', titulo: 'Tareas (sin asignar)' },
  { id: 'pendiente', titulo: 'Pendiente' },
  { id: 'en_curso', titulo: 'En curso' },
  { id: 'finalizado', titulo: 'Finalizado' },
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

const VISTA_TODAS_KEY = 'tablero-todas-las-areas'

function leerVistaTodas(): boolean {
  try {
    return localStorage.getItem(VISTA_TODAS_KEY) === '1'
  } catch {
    return false
  }
}

function guardarVistaTodas(valor: boolean) {
  try {
    localStorage.setItem(VISTA_TODAS_KEY, valor ? '1' : '0')
  } catch {
    // Sin almacenamiento disponible solo se pierde la preferencia entre visitas.
  }
}

export function BoardPage() {
  const { profile } = useAuth()
  const { areaActiva, esSuperadmin } = useArea()
  const areaId = areaActiva?.id
  const esLider = areaActiva?.rol === 'lider'
  // Tablero general: el superadmin puede ver las tareas de todas las áreas
  // juntas en vez de solo las del área activa.
  const [todasLasAreasGuardado, setTodasLasAreasGuardado] = useState(leerVistaTodas)
  const todasLasAreas = esSuperadmin && todasLasAreasGuardado
  const { agentes } = useMiembrosArea(areaId, todasLasAreas)
  const [tickets, setTickets] = useState<TicketConRelaciones[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroAgente, setFiltroAgente] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [vistaHistorial, setVistaHistorial] = useState(false)
  const [ticketSeleccionado, setTicketSeleccionado] = useState<TicketConRelaciones | null>(null)
  const [mostrarNuevaTarea, setMostrarNuevaTarea] = useState(false)
  const [ticketAFinalizar, setTicketAFinalizar] = useState<{
    ticketId: string
    titulo: string
    tiempoEjecutadoHoras: number | null
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
    if (!areaId && !todasLasAreas) return
    if (mostrarCarga) setLoading(true)
    let consulta = supabase.from('tickets').select(TICKET_SELECT)
    if (!todasLasAreas) consulta = consulta.eq('area_id', areaId!)
    const { data } = await consulta.order('created_at', { ascending: false })
    setTickets((data as unknown as TicketConRelaciones[]) ?? [])
    setLoading(false)
  }, [areaId, todasLasAreas])

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
      // Un ticket que se movió a otra área sale de este tablero aunque la
      // persona todavía pueda verlo por ser miembro de esa otra área.
      const actualizados = new Map(
        ((data as unknown as TicketConRelaciones[]) ?? [])
          .filter((t) => todasLasAreas || t.area_id === areaId)
          .map((t) => [t.id, t]),
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
  }, [areaId, todasLasAreas])

  useEffect(() => {
    void cargarTickets(true)

    const channel = supabase
      .channel(`${BOARD_CHANNEL}:${todasLasAreas ? 'todas' : areaId}`)
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
  }, [areaId, todasLasAreas, cargarTickets, programarActualizacion])

  const ticketsFiltrados = useMemo(() => {
    const limiteFinalizados = Date.now() - DIAS_FINALIZADOS_EN_TABLERO * 24 * 60 * 60 * 1000

    return tickets.filter((t) => {
      if (!coincideBusqueda(t, busqueda)) return false

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
  }, [tickets, busqueda, filtroAgente, vistaHistorial])

  function ticketsParaColumna(id: ColumnaId) {
    if (vistaHistorial) return id === 'finalizado' ? ticketsFiltrados : []
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

      if (nuevoEstado === 'finalizado') {
        setErrorFinalizar(null)
        setTicketAFinalizar({
          ticketId,
          titulo: ticket.titulo,
          tiempoEjecutadoHoras: ticket.tiempo_ejecutado_horas,
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
      setTicketAFinalizar({
        ticketId,
        titulo: ticket.titulo,
        tiempoEjecutadoHoras: ticket.tiempo_ejecutado_horas,
        cambios,
        estadoAnterior: ticket.estado,
      })
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

  async function confirmarFinalizacion(nota: string, tiempoEjecutadoHoras: number | null) {
    if (!ticketAFinalizar) return
    const { ticketId, cambios, estadoAnterior } = ticketAFinalizar
    setFinalizando(true)
    setErrorFinalizar(null)

    const cambiosFinales = {
      ...cambios,
      nota_finalizacion: nota || null,
      tiempo_ejecutado_horas: tiempoEjecutadoHoras,
    }
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

  function cambiarVistaTodas(valor: boolean) {
    setFiltroAgente('')
    setTodasLasAreasGuardado(valor)
    guardarVistaTodas(valor)
  }

  if (loading) return <div className="pantalla-carga">Cargando tablero...</div>

  return (
    <div className="board-page">
      <div className="board-page__toolbar">
        <div>
          <h1>{vistaHistorial ? 'Historial de finalizadas' : `Tablero · ${todasLasAreas ? 'Todas las áreas' : areaActiva?.nombre ?? ''}`}</h1>
          {vistaHistorial && <p className="board-page__subtitulo">Tareas finalizadas hace más de 30 días.</p>}
        </div>
        <div className="board-page__filtros">
          <input
            type="search"
            className="board-page__buscador"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por #, título, persona…"
            aria-label="Buscar tickets"
          />
          {esSuperadmin && (
            <select value={todasLasAreas ? 'todas' : 'area'} onChange={(e) => cambiarVistaTodas(e.target.value === 'todas')} aria-label="Áreas del tablero">
              <option value="area">Solo {areaActiva?.nombre ?? 'esta área'}</option>
              <option value="todas">Todas las áreas</option>
            </select>
          )}
          {esLider && (
            <select value={filtroAgente} onChange={(e) => setFiltroAgente(e.target.value)} aria-label="Filtrar por agente">
              <option value="">Todas las personas</option>
              <option value="sin_asignar">Sin asignar</option>
              {agentes.map((agente) => (
                <option key={agente.id} value={agente.id}>
                  {agente.full_name ?? agente.email}
                  {!todasLasAreas && ` (${agente.rolArea === 'lider' ? 'Líder' : 'Agente'})`}
                </option>
              ))}
            </select>
          )}
          {esLider && (
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
        <div className={`kanban-board ${vistaHistorial ? 'kanban-board--1' : 'kanban-board--4'}`}>
          {(vistaHistorial ? [{ id: 'finalizado' as const, titulo: 'Finalizadas archivadas' }] : COLUMNAS).map((columna) => (
            <KanbanColumn
              key={columna.id}
              id={columna.id}
              titulo={columna.titulo}
              tickets={ticketsParaColumna(columna.id)}
              puedeArrastrar={!vistaHistorial}
              onTicketClick={setTicketSeleccionado}
            />
          ))}
        </div>
      </DndContext>

      {ticketSeleccionado && (
        <TicketDetalleModal
          ticket={ticketSeleccionado}
          puedeEditarTiempos
          puedeEliminar={esLider}
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
          tiempoEjecutadoHoras={ticketAFinalizar.tiempoEjecutadoHoras}
          guardando={finalizando}
          error={errorFinalizar}
          onConfirmar={(nota, horas) => void confirmarFinalizacion(nota, horas)}
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
