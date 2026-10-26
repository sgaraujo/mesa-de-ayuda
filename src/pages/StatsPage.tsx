import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useArea } from '../context/AreaContext'
import { useProyectos } from '../hooks/useProyectos'
import {
  contarPor,
  dentroDeRango,
  formatearDuracion,
  formatearEtiquetaPeriodo,
  serieTemporal,
  type Agrupacion,
  type ConteoCategoria,
  type RangoFecha,
  type RangoPersonalizado,
} from '../lib/agregaciones'
import { nombresAsignados } from '../lib/ticket'
import { exportarReporteDetalladoExcel, exportarTicketsCSV } from '../lib/exportarCsv'
import { BarraHorizontal } from '../components/BarraHorizontal'
import { RankingLista } from '../components/RankingLista'
import { DonutChart } from '../components/DonutChart'
import { LineaTendencia } from '../components/LineaTendencia'
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

const RANGOS: { valor: RangoFecha; etiqueta: string }[] = [
  { valor: 'todo', etiqueta: 'Todo' },
  { valor: '7d', etiqueta: '7 días' },
  { valor: '30d', etiqueta: '30 días' },
  { valor: 'mes_actual', etiqueta: 'Este mes' },
  { valor: 'mes_anterior', etiqueta: 'Mes anterior' },
  { valor: 'personalizado', etiqueta: 'Personalizado' },
]

function formatearDia(fecha: string): string {
  return new Date(`${fecha}T00:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Texto del periodo para el subtítulo del encabezado.
function describirPeriodo(rango: RangoFecha, personalizado: RangoPersonalizado): string {
  switch (rango) {
    case 'todo': return 'todo el tiempo'
    case '7d': return 'los últimos 7 días'
    case '30d': return 'los últimos 30 días'
    case 'mes_actual': return 'este mes'
    case 'mes_anterior': return 'el mes anterior'
    case 'personalizado':
      if (personalizado.desde && personalizado.hasta) {
        return `del ${formatearDia(personalizado.desde)} al ${formatearDia(personalizado.hasta)}`
      }
      if (personalizado.desde) return `desde el ${formatearDia(personalizado.desde)}`
      if (personalizado.hasta) return `hasta el ${formatearDia(personalizado.hasta)}`
      return 'todo el tiempo'
  }
}

const DIAS_MAXIMOS_POR_DIA = 92

// La tendencia va por día en rangos cortos y por mes en los largos o abiertos,
// para que la gráfica no quede con cientos de puntos.
function agrupacionPara(rango: RangoFecha, personalizado: RangoPersonalizado): Agrupacion {
  if (rango === 'todo') return 'mes'
  if (rango !== 'personalizado') return 'dia'
  if (!personalizado.desde || !personalizado.hasta) return 'mes'
  const dias = (new Date(personalizado.hasta).getTime() - new Date(personalizado.desde).getTime()) / 86400000
  return dias > DIAS_MAXIMOS_POR_DIA ? 'mes' : 'dia'
}

export function StatsPage() {
  const [tickets, setTickets] = useState<TicketConRelaciones[]>([])
  const [loading, setLoading] = useState(true)
  const { areaActiva } = useArea()
  const areaId = areaActiva?.id
  const { proyectos } = useProyectos(areaId)

  const [filtroProyecto, setFiltroProyecto] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<Estado | ''>('')
  const [filtroRango, setFiltroRango] = useState<RangoFecha>('todo')
  const [rangoPersonalizado, setRangoPersonalizado] = useState<RangoPersonalizado>({ desde: '', hasta: '' })

  useEffect(() => {
    if (!areaId) return
    supabase
      .from('tickets')
      .select(TICKET_SELECT)
      .eq('area_id', areaId)
      .then(({ data }) => {
        setTickets((data as unknown as TicketConRelaciones[]) ?? [])
        setLoading(false)
      })
  }, [areaId])

  const ticketsBase = useMemo(() => {
    return tickets.filter(
      (t) =>
        (!filtroProyecto || t.proyecto_id === filtroProyecto) &&
        dentroDeRango(t.created_at, filtroRango, rangoPersonalizado),
    )
  }, [tickets, filtroProyecto, filtroRango, rangoPersonalizado])

  const ticketsFiltrados = useMemo(() => {
    return ticketsBase.filter((t) => !filtroEstado || t.estado === filtroEstado)
  }, [ticketsBase, filtroEstado])

  if (loading) return <div className="pantalla-carga">Cargando estadísticas...</div>

  const total = ticketsFiltrados.length
  const pendientes = ticketsFiltrados.filter((t) => t.estado === 'pendiente').length
  const enCurso = ticketsFiltrados.filter((t) => t.estado === 'en_curso').length
  const finalizados = ticketsFiltrados.filter((t) => t.estado === 'finalizado').length
  const rechazados = ticketsFiltrados.filter((t) => t.estado === 'rechazado').length

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

  const porAgente = contarPorPersonaAsignada(ticketsFiltrados)
  const porEmpresa = contarPor(ticketsFiltrados, (t) => t.empresa_solicitante)
  const porProyecto = contarPor(ticketsFiltrados, (t) => t.proyecto?.nombre ?? null)
  const porPersonaResuelto = contarPorPersonaAsignada(ticketsBase.filter((t) => t.estado === 'finalizado'))
  const agrupacionTendencia = agrupacionPara(filtroRango, rangoPersonalizado)
  const tendencia = serieTemporal(ticketsBase, agrupacionTendencia, filtroRango, rangoPersonalizado)

  const hayFiltros = filtroProyecto !== '' || filtroEstado !== '' || filtroRango !== 'todo'

  return (
    <div className="stats-page">
      <div className="board-page__toolbar">
        <div className="board-page__encabezado">
          <p className="board-page__eyebrow">Estadísticas</p>
          <h1>{areaActiva?.nombre ?? ''}</h1>
          <p className="board-page__subtitulo">
            {total} {total === 1 ? 'solicitud creada' : 'solicitudes creadas'} en {describirPeriodo(filtroRango, rangoPersonalizado)}
          </p>
        </div>
        <div className="board-page__acciones">
          <button type="button" className="boton-secundario" onClick={() => exportarTicketsCSV(ticketsFiltrados)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
            </svg>
            CSV
          </button>
          <button type="button" className="boton-secundario" onClick={() => void exportarReporteDetalladoExcel(ticketsFiltrados)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
            </svg>
            Excel
          </button>
        </div>
      </div>

      <div className="board-page__filtros board-page__filtros--barra">
        <div className="segmentado stats-periodo" role="group" aria-label="Periodo">
          {RANGOS.map((rango) => (
            <button
              key={rango.valor}
              type="button"
              aria-pressed={filtroRango === rango.valor}
              onClick={() => setFiltroRango(rango.valor)}
            >
              {rango.etiqueta}
            </button>
          ))}
        </div>
        {filtroRango === 'personalizado' && (
          <div className="stats-filtros__rango" role="group" aria-label="Rango de fechas">
            <label>
              Desde
              <input
                type="date"
                value={rangoPersonalizado.desde}
                max={rangoPersonalizado.hasta || undefined}
                onChange={(e) => setRangoPersonalizado((r) => ({ ...r, desde: e.target.value }))}
              />
            </label>
            <label>
              Hasta
              <input
                type="date"
                value={rangoPersonalizado.hasta}
                min={rangoPersonalizado.desde || undefined}
                onChange={(e) => setRangoPersonalizado((r) => ({ ...r, hasta: e.target.value }))}
              />
            </label>
          </div>
        )}
        <select value={filtroProyecto} onChange={(e) => setFiltroProyecto(e.target.value)} aria-label="Filtrar por proyecto">
          <option value="">Todos los proyectos</option>
          {proyectos.map((proyecto) => (
            <option key={proyecto.id} value={proyecto.id}>
              {proyecto.nombre}
            </option>
          ))}
        </select>
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value as Estado | '')} aria-label="Filtrar por estado">
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="en_curso">En curso</option>
          <option value="finalizado">Finalizado</option>
          <option value="rechazado">Rechazado</option>
        </select>
        {hayFiltros && (
          <button
            type="button"
            className="board-page__limpiar"
            onClick={() => {
              setFiltroProyecto('')
              setFiltroEstado('')
              setFiltroRango('todo')
              setRangoPersonalizado({ desde: '', hasta: '' })
            }}
          >
            Limpiar filtros
          </button>
        )}
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
        <div className="stat-tile stat-tile--rechazado">
          <p className="stat-tile__label">Rechazadas</p>
          <p className="stat-tile__value">{rechazados}</p>
        </div>
        <div className="stat-tile">
          <p className="stat-tile__label">Tiempo promedio de resolución</p>
          <p className="stat-tile__value">
            {promedioHoras !== null ? formatearDuracion(promedioHoras) : '—'}
          </p>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-card chart-card--ancho">
          <h2>Tendencia de solicitudes</h2>
          <LineaTendencia
            datos={tendencia}
            formatearEtiqueta={(periodo) => formatearEtiquetaPeriodo(periodo, agrupacionTendencia)}
          />
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
