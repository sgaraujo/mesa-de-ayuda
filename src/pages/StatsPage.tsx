import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { contarPor, formatearDuracion, type ConteoCategoria } from '../lib/agregaciones'
import { nombresAsignados } from '../lib/ticket'
import { BarraHorizontal } from '../components/BarraHorizontal'
import type { TicketConRelaciones } from '../types/database'

const TICKET_SELECT = `
  *,
  solicitante:profiles!tickets_solicitante_id_fkey(id, full_name, email),
  asignado:profiles!tickets_asignado_a_fkey(id, full_name, email),
  area:areas(id, nombre),
  proyecto:proyectos(id, nombre),
  asignados:ticket_asignados(profile:profiles(id, full_name, email))
`

function contarPorPersonaAsignada(tickets: TicketConRelaciones[]): ConteoCategoria[] {
  const conteo = new Map<string, number>()
  for (const ticket of tickets) {
    const nombres = nombresAsignados(ticket)
    const claves = nombres.length > 0 ? nombres : ['Bandeja general']
    for (const nombre of claves) {
      conteo.set(nombre, (conteo.get(nombre) ?? 0) + 1)
    }
  }
  return Array.from(conteo.entries())
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total)
}

export function StatsPage() {
  const [tickets, setTickets] = useState<TicketConRelaciones[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('tickets')
      .select(TICKET_SELECT)
      .then(({ data }) => {
        setTickets((data as unknown as TicketConRelaciones[]) ?? [])
        setLoading(false)
      })
  }, [])

  if (loading) return <div className="pantalla-carga">Cargando estadísticas...</div>

  const total = tickets.length
  const pendientes = tickets.filter((t) => t.estado === 'pendiente').length
  const enCurso = tickets.filter((t) => t.estado === 'en_curso').length
  const finalizados = tickets.filter((t) => t.estado === 'finalizado').length

  const finalizadosConTiempo = tickets.filter((t) => t.estado === 'finalizado' && t.finalizado_at)
  const promedioHoras =
    finalizadosConTiempo.length > 0
      ? finalizadosConTiempo.reduce((acc, t) => {
          const horas =
            (new Date(t.finalizado_at!).getTime() - new Date(t.created_at).getTime()) /
            (1000 * 60 * 60)
          return acc + horas
        }, 0) / finalizadosConTiempo.length
      : null

  const porArea = contarPor(tickets, (t) => t.area?.nombre ?? null)
  const porAgente = contarPorPersonaAsignada(tickets)
  const porEmpresa = contarPor(tickets, (t) => t.empresa_solicitante)
  const porProyecto = contarPor(tickets, (t) => t.proyecto?.nombre ?? null)

  return (
    <div className="stats-page">
      <h1>Estadísticas</h1>

      <div className="stat-tiles">
        <div className="stat-tile">
          <p className="stat-tile__label">Total de solicitudes</p>
          <p className="stat-tile__value">{total}</p>
        </div>
        <div className="stat-tile stat-tile--pendiente">
          <p className="stat-tile__label">Pendientes</p>
          <p className="stat-tile__value">{pendientes}</p>
        </div>
        <div className="stat-tile stat-tile--en_curso">
          <p className="stat-tile__label">En curso</p>
          <p className="stat-tile__value">{enCurso}</p>
        </div>
        <div className="stat-tile stat-tile--finalizado">
          <p className="stat-tile__label">Finalizadas</p>
          <p className="stat-tile__value">{finalizados}</p>
        </div>
        <div className="stat-tile">
          <p className="stat-tile__label">Tiempo promedio de resolución</p>
          <p className="stat-tile__value">
            {promedioHoras !== null ? formatearDuracion(promedioHoras) : '—'}
          </p>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-card">
          <h2>Solicitudes por área</h2>
          <BarraHorizontal datos={porArea} />
        </div>
        <div className="chart-card">
          <h2>Solicitudes por persona asignada</h2>
          <BarraHorizontal datos={porAgente} />
        </div>
        <div className="chart-card">
          <h2>Solicitudes por empresa solicitante</h2>
          <BarraHorizontal datos={porEmpresa} />
        </div>
        <div className="chart-card">
          <h2>Solicitudes por proyecto</h2>
          <BarraHorizontal datos={porProyecto} />
        </div>
      </div>
    </div>
  )
}
