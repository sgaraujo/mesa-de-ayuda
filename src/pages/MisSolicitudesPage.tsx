import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { TicketDetalleModal } from '../components/TicketDetalleModal'
import { coincideBusqueda, esperaAprobacion, fueRechazada, nombresAsignados, TICKET_SELECT } from '../lib/ticket'
import type { Estado, TicketConRelaciones } from '../types/database'

const ESTADO_LABEL: Record<Estado, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
  rechazado: 'Rechazada',
}

function formatearFechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Todo lo que la persona pidió, a cualquier área, más las tareas donde la
// mencionaron (@) en un comentario. Quien no es miembro de un área no ve ese
// tablero, así que sigue esas tareas desde aquí; RLS solo le devuelve sus
// propios tickets (solicitante_id) y aquellos en que fue mencionada.
type Relacion = '' | 'pedidas' | 'mencionado'
type FiltroEstado = Estado | '' | 'por_aprobar'
export function MisSolicitudesPage() {
  const { profile } = useAuth()
  const profileId = profile?.id
  const [tickets, setTickets] = useState<TicketConRelaciones[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('')
  const [filtroRelacion, setFiltroRelacion] = useState<Relacion>('')
  const [idsMencionado, setIdsMencionado] = useState<Set<string>>(new Set())
  const [ticketSeleccionado, setTicketSeleccionado] = useState<TicketConRelaciones | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const ticketEnlace = searchParams.get('ticket')

  const cargar = useCallback(async () => {
    if (!profileId) return
    const { data: menciones } = await supabase
      .from('ticket_menciones')
      .select('ticket_id')
      .eq('profile_id', profileId)
    const mencionado = new Set((menciones ?? []).map((m) => m.ticket_id as string))

    let consulta = supabase.from('tickets').select(TICKET_SELECT)
    consulta = mencionado.size > 0
      ? consulta.or(`solicitante_id.eq.${profileId},id.in.(${[...mencionado].join(',')})`)
      : consulta.eq('solicitante_id', profileId)
    const { data } = await consulta.order('created_at', { ascending: false })
    setIdsMencionado(mencionado)
    setTickets((data as unknown as TicketConRelaciones[]) ?? [])
    setLoading(false)
  }, [profileId])

  // El correo de una mención enlaza a /mis-solicitudes?ticket=<id>: se abre
  // esa tarea directamente.
  useEffect(() => {
    if (!ticketEnlace || loading) return
    const ticket = tickets.find((t) => t.id === ticketEnlace)
    if (ticket) setTicketSeleccionado(ticket)
    setSearchParams({}, { replace: true })
  }, [ticketEnlace, loading, tickets, setSearchParams])

  useEffect(() => {
    void cargar()
    if (!profileId) return

    const channel = supabase
      .channel(`mis-solicitudes:${profileId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tickets', filter: `solicitante_id=eq.${profileId}` },
        () => void cargar(),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [profileId, cargar])

  const visibles = useMemo(
    () => tickets.filter((t) => {
      if (filtroEstado === 'por_aprobar') {
        if (!(esperaAprobacion(t) && t.solicitante_id === profileId)) return false
      } else if (filtroEstado && t.estado !== filtroEstado) return false
      if (filtroRelacion === 'pedidas' && t.solicitante_id !== profileId) return false
      if (filtroRelacion === 'mencionado' && !idsMencionado.has(t.id)) return false
      return coincideBusqueda(t, busqueda)
    }),
    [tickets, filtroEstado, filtroRelacion, idsMencionado, profileId, busqueda],
  )

  const porAprobar = tickets.filter((t) => esperaAprobacion(t) && t.solicitante_id === profileId).length

  if (loading) return <div className="pantalla-carga">Cargando solicitudes...</div>

  return (
    <div className="admin-page">
      <div className="board-page__toolbar">
        <div>
          <h1>Mis solicitudes</h1>
          <p className="board-page__subtitulo">Todo lo que has pedido, a cualquier área, y las tareas donde te mencionaron.</p>
        </div>
        <div className="board-page__filtros">
          <input
            type="search"
            className="board-page__buscador"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por #, título, área…"
            aria-label="Buscar solicitudes"
          />
          <select value={filtroRelacion} onChange={(e) => setFiltroRelacion(e.target.value as Relacion)} aria-label="Filtrar por relación">
            <option value="">Pedidas y menciones</option>
            <option value="pedidas">Pedidas por mí</option>
            <option value="mencionado">Me mencionaron</option>
          </select>
          <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value as FiltroEstado)} aria-label="Filtrar por estado">
            <option value="">Todos los estados</option>
            <option value="por_aprobar">Por aprobar</option>
            <option value="pendiente">Pendiente</option>
            <option value="en_curso">En curso</option>
            <option value="finalizado">Finalizado</option>
            <option value="rechazado">Rechazada</option>
          </select>
        </div>
      </div>

      {porAprobar > 0 && filtroEstado !== 'por_aprobar' && (
        <div className="mis-solicitudes__aviso" role="status">
          <span>
            {porAprobar === 1
              ? <>Tienes <strong>1 solicitud finalizada</strong> esperando tu aprobación.</>
              : <>Tienes <strong>{porAprobar} solicitudes finalizadas</strong> esperando tu aprobación.</>}
          </span>
          <button type="button" onClick={() => setFiltroEstado('por_aprobar')}>Revisarlas</button>
        </div>
      )}

      <div className="admin-table-scroll">
        <table className="admin-table mis-solicitudes">
          <thead>
            <tr>
              <th>N.º</th>
              <th>Título</th>
              <th>Área</th>
              <th>Estado</th>
              <th>Atendido por</th>
              <th>Solicitado</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((t) => (
              <tr key={t.id} onClick={() => setTicketSeleccionado(t)} className="mis-solicitudes__fila">
                <td className="ticket-numero">#{t.numero}</td>
                <td>
                  {t.titulo}
                  {idsMencionado.has(t.id) && <span className="badge badge--mencion">@ Mencionado</span>}
                </td>
                <td>{t.area?.nombre ?? '—'}</td>
                <td>
                  <span className={`badge badge--estado-${t.estado}`}>{ESTADO_LABEL[t.estado]}</span>
                  {esperaAprobacion(t) && t.solicitante_id === profileId && (
                    <span className="badge badge--por-aprobar mis-solicitudes__aprobacion">Por aprobar</span>
                  )}
                  {fueRechazada(t) && <span className="badge badge--rechazada mis-solicitudes__aprobacion">Rechazada</span>}
                </td>
                <td>
                  <span className="admin-table__texto-sutil">{nombresAsignados(t).join(', ') || 'Sin asignar'}</span>
                </td>
                <td>
                  <span className="admin-table__texto-sutil">{formatearFechaCorta(t.created_at)}</span>
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={6} className="admin-table__texto-sutil">
                  {tickets.length === 0 ? 'Todavía no has enviado solicitudes.' : 'Ninguna solicitud coincide con la búsqueda.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {ticketSeleccionado && (
        <TicketDetalleModal
          ticket={ticketSeleccionado}
          puedeEditarTiempos={false}
          puedeEliminar={false}
          onClose={() => setTicketSeleccionado(null)}
          onGuardado={() => setTicketSeleccionado(null)}
          onEliminado={() => setTicketSeleccionado(null)}
        />
      )}
    </div>
  )
}
