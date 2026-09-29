import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { TicketDetalleModal } from '../components/TicketDetalleModal'
import { coincideBusqueda, nombresAsignados } from '../lib/ticket'
import type { Estado, TicketConRelaciones } from '../types/database'

const TICKET_SELECT = `
  *,
  solicitante:profiles!tickets_solicitante_id_fkey(id, full_name, email),
  asignado:profiles!tickets_asignado_a_fkey(id, full_name, email),
  area:areas(id, nombre),
  proyecto:proyectos(id, nombre),
  asignados:ticket_asignados(profile:profiles(id, full_name, email))
`

const ESTADO_LABEL: Record<Estado, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
}

function formatearFechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Todo lo que la persona pidió, a cualquier área. Quien envía una solicitud a
// un área de la que no es miembro no ve ese tablero, así que la sigue desde
// aquí; RLS solo le devuelve sus propios tickets (solicitante_id).
export function MisSolicitudesPage() {
  const { profile } = useAuth()
  const profileId = profile?.id
  const [tickets, setTickets] = useState<TicketConRelaciones[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<Estado | ''>('')
  const [ticketSeleccionado, setTicketSeleccionado] = useState<TicketConRelaciones | null>(null)

  const cargar = useCallback(async () => {
    if (!profileId) return
    const { data } = await supabase
      .from('tickets')
      .select(TICKET_SELECT)
      .eq('solicitante_id', profileId)
      .order('created_at', { ascending: false })
    setTickets((data as unknown as TicketConRelaciones[]) ?? [])
    setLoading(false)
  }, [profileId])

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
    () => tickets.filter((t) => (!filtroEstado || t.estado === filtroEstado) && coincideBusqueda(t, busqueda)),
    [tickets, filtroEstado, busqueda],
  )

  if (loading) return <div className="pantalla-carga">Cargando solicitudes...</div>

  return (
    <div className="admin-page">
      <div className="board-page__toolbar">
        <div>
          <h1>Mis solicitudes</h1>
          <p className="board-page__subtitulo">Todo lo que has pedido, a cualquier área.</p>
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
          <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value as Estado | '')} aria-label="Filtrar por estado">
            <option value="">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="en_curso">En curso</option>
            <option value="finalizado">Finalizado</option>
          </select>
        </div>
      </div>

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
                <td>{t.titulo}</td>
                <td>{t.area?.nombre ?? '—'}</td>
                <td>
                  <span className={`badge badge--estado-${t.estado}`}>{ESTADO_LABEL[t.estado]}</span>
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
