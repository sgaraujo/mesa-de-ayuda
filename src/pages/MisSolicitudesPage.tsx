import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { TicketDetalleModal } from '../components/TicketDetalleModal'
import { SemaforoVencimiento } from '../components/SemaforoVencimiento'
import { semaforo } from '../lib/vencimiento'
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

// Todo lo que la persona pidió, a cualquier área, las tareas donde la
// mencionaron (@) en un comentario y las solicitudes de otros que ella
// rechazó. El tablero oculta las rechazadas, así que quien rechaza las sigue
// desde aquí. RLS solo devuelve los tickets que la persona puede ver.
type Relacion = '' | 'pedidas' | 'mencionado' | 'rechazadas'
type FiltroEstado = Estado | '' | 'por_aprobar'

const PESTANAS_ESTADO: { valor: FiltroEstado; label: string }[] = [
  { valor: '', label: 'Todas' },
  { valor: 'por_aprobar', label: 'Por aprobar' },
  { valor: 'pendiente', label: 'Pendientes' },
  { valor: 'en_curso', label: 'En curso' },
  { valor: 'finalizado', label: 'Finalizadas' },
  { valor: 'rechazado', label: 'Rechazadas' },
]

export function MisSolicitudesPage() {
  const { profile } = useAuth()
  const profileId = profile?.id
  const [tickets, setTickets] = useState<TicketConRelaciones[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('')
  const [filtroRelacion, setFiltroRelacion] = useState<Relacion>('')
  const [idsMencionado, setIdsMencionado] = useState<Set<string>>(new Set())
  const [idsRechazadasPorMi, setIdsRechazadasPorMi] = useState<Set<string>>(new Set())
  const [ticketSeleccionado, setTicketSeleccionado] = useState<TicketConRelaciones | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const ticketEnlace = searchParams.get('ticket')

  const cargar = useCallback(async () => {
    if (!profileId) return
    const [{ data: menciones }, { data: rechazos }] = await Promise.all([
      supabase.from('ticket_menciones').select('ticket_id').eq('profile_id', profileId),
      supabase.from('ticket_status_history').select('ticket_id').eq('changed_by', profileId).eq('estado', 'rechazado'),
    ])
    const mencionado = new Set((menciones ?? []).map((m) => m.ticket_id as string))
    const rechazadas = new Set((rechazos ?? []).map((r) => r.ticket_id as string))
    const otros = [...new Set([...mencionado, ...rechazadas])]

    let consulta = supabase.from('tickets').select(TICKET_SELECT)
    // También las que el líder registró a su nombre (solicitado_por_id, migración 0053).
    consulta = otros.length > 0
      ? consulta.or(`solicitante_id.eq.${profileId},solicitado_por_id.eq.${profileId},id.in.(${otros.join(',')})`)
      : consulta.or(`solicitante_id.eq.${profileId},solicitado_por_id.eq.${profileId}`)
    const { data } = await consulta.order('created_at', { ascending: false })
    const cargados = (data as unknown as TicketConRelaciones[]) ?? []

    // Una rechazada que alguien reabrió vuelve al tablero: deja de contar
    // como "rechazada por mí".
    const sigueRechazada = new Set(cargados.filter((t) => t.estado === 'rechazado').map((t) => t.id))
    const rechazadasVigentes = new Set([...rechazadas].filter((id) => sigueRechazada.has(id)))

    setIdsMencionado(mencionado)
    setIdsRechazadasPorMi(rechazadasVigentes)
    setTickets(cargados.filter((t) =>
      t.solicitante_id === profileId || t.solicitado_por_id === profileId || mencionado.has(t.id) || rechazadasVigentes.has(t.id)))
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

  const esPorAprobar = useCallback(
    (t: TicketConRelaciones) => esperaAprobacion(t) && t.solicitante_id === profileId,
    [profileId],
  )

  // Relación y búsqueda primero; los conteos de las pestañas de estado salen
  // de aquí para que cuadren con lo que se ve.
  const segunRelacion = useMemo(
    () => tickets.filter((t) => {
      if (filtroRelacion === 'pedidas' && t.solicitante_id !== profileId && t.solicitado_por_id !== profileId) return false
      if (filtroRelacion === 'mencionado' && !idsMencionado.has(t.id)) return false
      if (filtroRelacion === 'rechazadas' && !idsRechazadasPorMi.has(t.id)) return false
      return coincideBusqueda(t, busqueda)
    }),
    [tickets, filtroRelacion, idsMencionado, idsRechazadasPorMi, profileId, busqueda],
  )

  const cumpleEstado = useCallback(
    (t: TicketConRelaciones, estado: FiltroEstado) => {
      if (estado === 'por_aprobar') return esPorAprobar(t)
      return !estado || t.estado === estado
    },
    [esPorAprobar],
  )

  const visibles = useMemo(
    () => segunRelacion.filter((t) => cumpleEstado(t, filtroEstado)),
    [segunRelacion, filtroEstado, cumpleEstado],
  )

  const porAprobar = tickets.filter(esPorAprobar).length
  const hayFiltros = !!busqueda.trim() || !!filtroEstado || !!filtroRelacion

  function limpiarFiltros() {
    setBusqueda('')
    setFiltroEstado('')
    setFiltroRelacion('')
  }

  if (loading) return <div className="pantalla-carga">Cargando solicitudes...</div>

  return (
    <div className="admin-page">
      <div className="board-page__toolbar mis-solicitudes__encabezado">
        <div>
          <h1>Mis solicitudes</h1>
          <p className="board-page__subtitulo">Lo que has pedido a cualquier área, las tareas donde te mencionaron y las solicitudes que rechazaste.</p>
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

      <div className="mis-solicitudes__panel">
        <div className="mis-solicitudes__pestanas" role="group" aria-label="Filtrar por estado">
          {PESTANAS_ESTADO.map(({ valor, label }) => {
            const cantidad = segunRelacion.filter((t) => cumpleEstado(t, valor)).length
            return (
              <button
                key={valor || 'todas'}
                type="button"
                aria-pressed={filtroEstado === valor}
                onClick={() => setFiltroEstado(valor)}
                className={valor === 'por_aprobar' && cantidad > 0 ? 'mis-solicitudes__pestana--alerta' : undefined}
              >
                {label}
                <span className="mis-solicitudes__conteo">{cantidad}</span>
              </button>
            )
          })}
        </div>

        <div className="board-page__filtros mis-solicitudes__filtros">
          <input
            type="search"
            className="board-page__buscador"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por #, título, área…"
            aria-label="Buscar solicitudes"
          />
          <select value={filtroRelacion} onChange={(e) => setFiltroRelacion(e.target.value as Relacion)} aria-label="Filtrar por relación">
            <option value="">Todas mis relaciones</option>
            <option value="pedidas">Pedidas por mí</option>
            <option value="mencionado">Me mencionaron</option>
            <option value="rechazadas">Rechazadas por mí</option>
          </select>
          {hayFiltros && (
            <button type="button" className="board-page__limpiar" onClick={limpiarFiltros}>Limpiar filtros</button>
          )}
        </div>

        <div className="admin-table-scroll mis-solicitudes__tabla">
          <table className="admin-table mis-solicitudes">
            <thead>
              <tr>
                <th>N.º</th>
                <th>Solicitud</th>
                <th>Área</th>
                <th>Estado</th>
                <th>Atendido por</th>
                <th>Vencimiento</th>
                <th>Solicitado</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((t) => {
                // Si el líder la registró por otra persona (migración 0053),
                // esa persona es quien la pidió.
                const pedidaPor = t.solicitado_por_id === profileId
                  ? null
                  : t.solicitado_por_nombre
                    ?? (t.solicitante_id !== profileId && t.solicitante ? t.solicitante.full_name ?? t.solicitante.email : null)
                return (
                  <tr key={t.id} onClick={() => setTicketSeleccionado(t)} className="mis-solicitudes__fila">
                    <td className="ticket-numero">#{t.numero}</td>
                    <td>
                      <div className="mis-solicitudes__solicitud">
                        <span className="mis-solicitudes__titulo">{t.titulo}</span>
                        <span className="mis-solicitudes__etiquetas">
                          {idsMencionado.has(t.id) && <span className="badge--mencion">@ Mencionado</span>}
                          {idsRechazadasPorMi.has(t.id) && <span className="badge--mencion mis-solicitudes__rechazaste">La rechazaste</span>}
                          {pedidaPor && <span className="mis-solicitudes__detalle">Pedida por {pedidaPor}</span>}
                        </span>
                        {t.estado === 'rechazado' && t.motivo_rechazo && (
                          <span className="mis-solicitudes__motivo" title={t.motivo_rechazo}>Motivo: {t.motivo_rechazo}</span>
                        )}
                      </div>
                    </td>
                    <td>{t.area?.nombre ?? '—'}</td>
                    <td>
                      <span className="mis-solicitudes__estados">
                        <span className={`badge badge--estado-${t.estado}`}>{ESTADO_LABEL[t.estado]}</span>
                        {esPorAprobar(t) && <span className="badge badge--por-aprobar">Por aprobar</span>}
                        {fueRechazada(t) && (
                          <span className="badge badge--rechazada" title="Quien la pidió rechazó la finalización; mira el motivo en los comentarios">Devuelta</span>
                        )}
                      </span>
                    </td>
                    <td className="mis-solicitudes__secundario">{nombresAsignados(t).join(', ') || 'Sin asignar'}</td>
                    <td className="mis-solicitudes__secundario">
                      {semaforo(t) ? <SemaforoVencimiento ticket={t} /> : '—'}
                    </td>
                    <td className="mis-solicitudes__secundario mis-solicitudes__fecha">{formatearFechaCorta(t.created_at)}</td>
                  </tr>
                )
              })}
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={7} className="mis-solicitudes__vacio">
                    <p>{tickets.length === 0 ? 'Todavía no tienes solicitudes.' : 'Ninguna solicitud coincide con los filtros.'}</p>
                    {tickets.length > 0 && hayFiltros && (
                      <button type="button" className="board-page__limpiar" onClick={limpiarFiltros}>Limpiar filtros</button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
