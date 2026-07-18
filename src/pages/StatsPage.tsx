import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAreas } from '../hooks/useAreas'
import { useProyectos } from '../hooks/useProyectos'
import {
  contarPor,
  dentroDeRango,
  formatearDuracion,
  type ConteoCategoria,
  type RangoFecha,
} from '../lib/agregaciones'
import { nombresAsignados } from '../lib/ticket'
import { BarraHorizontal } from '../components/BarraHorizontal'
import { RankingLista } from '../components/RankingLista'
import { DonutChart } from '../components/DonutChart'
import type { Estado, TicketConRelaciones } from '../types/database'

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
  const { areas } = useAreas()
  const { proyectos } = useProyectos()

  const [filtroArea, setFiltroArea] = useState('')
  const [filtroProyecto, setFiltroProyecto] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<Estado | ''>('')
  const [filtroRango, setFiltroRango] = useState<RangoFecha>('todo')

  useEffect(() => {
    supabase
      .from('tickets')
      .select(TICKET_SELECT)
      .then(({ data }) => {
        setTickets((data as unknown as TicketConRelaciones[]) ?? [])
        setLoading(false)
      })
  }, [])

  const ticketsBase = useMemo(() => {
    return tickets.filter(
      (t) =>
        (!filtroArea || t.area_id === filtroArea) &&
        (!filtroProyecto || t.proyecto_id === filtroProyecto) &&
        dentroDeRango(t.created_at, filtroRango),
    )
  }, [tickets, filtroArea, filtroProyecto, filtroRango])

  const ticketsFiltrados = useMemo(() => {
    return ticketsBase.filter((t) => !filtroEstado || t.estado === filtroEstado)
  }, [ticketsBase, filtroEstado])

  if (loading) return <div className="pantalla-carga">Cargando estadísticas...</div>

  const total = ticketsFiltrados.length
  const pendientes = ticketsFiltrados.filter((t) => t.estado === 'pendiente').length
  const enCurso = ticketsFiltrados.filter((t) => t.estado === 'en_curso').length
  const finalizados = ticketsFiltrados.filter((t) => t.estado === 'finalizado').length

  const finalizadosConTiempo = ticketsFiltrados.filter((t) => t.estado === 'finalizado' && t.finalizado_at)
  const promedioHoras =
    finalizadosConTiempo.length > 0
      ? finalizadosConTiempo.reduce((acc, t) => {
          const horas =
            (new Date(t.finalizado_at!).getTime() - new Date(t.created_at).getTime()) /
            (1000 * 60 * 60)
          return acc + horas
        }, 0) / finalizadosConTiempo.length
      : null

  const porArea = contarPor(ticketsFiltrados, (t) => t.area?.nombre ?? null)
  const porAgente = contarPorPersonaAsignada(ticketsFiltrados)
  const porEmpresa = contarPor(ticketsFiltrados, (t) => t.empresa_solicitante)
  const porProyecto = contarPor(ticketsFiltrados, (t) => t.proyecto?.nombre ?? null)
  const porPersonaResuelto = contarPorPersonaAsignada(ticketsBase.filter((t) => t.estado === 'finalizado'))

  return (
    <div className="stats-page">
      <h1>Estadísticas</h1>

      <div className="stats-filtros">
        <select value={filtroArea} onChange={(e) => setFiltroArea(e.target.value)}>
          <option value="">Todas las áreas</option>
          {areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.nombre}
            </option>
          ))}
        </select>
        <select value={filtroProyecto} onChange={(e) => setFiltroProyecto(e.target.value)}>
          <option value="">Todos los proyectos</option>
          {proyectos.map((proyecto) => (
            <option key={proyecto.id} value={proyecto.id}>
              {proyecto.nombre}
            </option>
          ))}
        </select>
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value as Estado | '')}>
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="en_curso">En curso</option>
          <option value="finalizado">Finalizado</option>
        </select>
        <select value={filtroRango} onChange={(e) => setFiltroRango(e.target.value as RangoFecha)}>
          <option value="todo">Todo el tiempo</option>
          <option value="7d">Últimos 7 días</option>
          <option value="30d">Últimos 30 días</option>
          <option value="mes_actual">Este mes</option>
          <option value="mes_anterior">Mes anterior</option>
        </select>
      </div>

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
          <h2>Ranking por proyecto</h2>
          <RankingLista datos={porProyecto} />
        </div>
        <div className="chart-card">
          <h2>Tickets resueltos por persona</h2>
          <DonutChart datos={porPersonaResuelto} centroEtiqueta="Resueltos" />
        </div>
        <div className="chart-card">
          <h2>Solicitudes por persona asignada</h2>
          <BarraHorizontal datos={porAgente} />
        </div>
        <div className="chart-card">
          <h2>Solicitudes por empresa solicitante</h2>
          <BarraHorizontal datos={porEmpresa} />
        </div>
      </div>
    </div>
  )
}
