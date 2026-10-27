import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useArea } from '../context/AreaContext'
import {
  claveFecha,
  contarPor,
  dentroDeRango,
  formatearDuracion,
  formatearEtiquetaPeriodo,
  serieTemporal,
  sumarPor,
  type Agrupacion,
  type ConteoCategoria,
  type RangoFecha,
  type RangoPersonalizado,
} from '../lib/agregaciones'
import { nombresAsignados } from '../lib/ticket'
import { cumplioATiempo, horasDeRetraso, semaforo } from '../lib/vencimiento'
import { exportarReporteDetalladoExcel, exportarTicketsCSV } from '../lib/exportarCsv'
import { BarraHorizontal } from '../components/BarraHorizontal'
import { RankingLista } from '../components/RankingLista'
import { DonutChart } from '../components/DonutChart'
import { LineaTendencia } from '../components/LineaTendencia'
import { nombreDe } from '../lib/menciones'
import { useUsuariosActivos } from '../hooks/useUsuariosActivos'
import { SelectorPersona, type PersonaOpcion } from '../components/SelectorPersona'

// Valores del filtro de responsables que no son personas.
const NO_SON_PERSONAS = new Set(['Bandeja general', 'Sin responsable'])
import type { Estado, Profile, TicketConRelaciones, TicketSubtarea } from '../types/database'

// Lo que hace falta de cada subtarea para las horas (migración 0042).
type SubtareaHoras = Pick<TicketSubtarea, 'ticket_id' | 'titulo' | 'tiempo_ejecutado_horas'> & {
  responsable: Pick<Profile, 'full_name' | 'email'> | null
}

function responsableSubtarea(subtarea: SubtareaHoras): string {
  return subtarea.responsable ? nombreDe(subtarea.responsable) : 'Sin responsable'
}

// Horas ejecutadas por persona: las de cada subtarea van a su responsable;
// las de una tarea sin subtareas, a sus responsables (repartidas por igual
// si es en grupo).
function horasPorPersona(tickets: TicketConRelaciones[], subtareasPorTicket: Map<string, SubtareaHoras[]>): ConteoCategoria[] {
  const filas: { nombre: string; horas: number }[] = []
  for (const ticket of tickets) {
    const subtareas = subtareasPorTicket.get(ticket.id) ?? []
    if (subtareas.length > 0) {
      for (const s of subtareas) filas.push({ nombre: responsableSubtarea(s), horas: s.tiempo_ejecutado_horas ?? 0 })
    } else if (ticket.tiempo_ejecutado_horas) {
      const nombres = responsablesDe(ticket)
      for (const nombre of nombres) filas.push({ nombre, horas: ticket.tiempo_ejecutado_horas / nombres.length })
    }
  }
  return sumarPor(filas, (f) => f.nombre, (f) => f.horas)
}

const TICKET_SELECT = `
  *,
  solicitante:profiles!tickets_solicitante_id_fkey(id, full_name, email),
  asignado:profiles!tickets_asignado_a_fkey(id, full_name, email),
  area:areas(id, nombre),
  proyecto:proyectos(id, nombre),
  asignados:ticket_asignados(profile:profiles(id, full_name, email))
`

function responsablesDe(ticket: TicketConRelaciones): string[] {
  const nombres = nombresAsignados(ticket)
  return nombres.length > 0 ? nombres : ['Bandeja general']
}

function contarPorPersonaAsignada(tickets: TicketConRelaciones[]): ConteoCategoria[] {
  const conteo = new Map<string, number>()
  for (const ticket of tickets) {
    for (const nombre of responsablesDe(ticket)) {
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

type Vista = 'resumen' | 'horas' | 'cumplimiento'

const VISTAS: { valor: Vista; etiqueta: string }[] = [
  { valor: 'resumen', etiqueta: 'Resumen' },
  { valor: 'horas', etiqueta: 'Horas' },
  { valor: 'cumplimiento', etiqueta: 'Cumplimiento' },
]

const VISTA_KEY = 'estadisticas-vista'

function leerVista(): Vista {
  try {
    const guardada = localStorage.getItem(VISTA_KEY)
    return VISTAS.some((v) => v.valor === guardada) ? (guardada as Vista) : 'resumen'
  } catch {
    return 'resumen'
  }
}

// Totales de horas en horas (formatearDuracion pasaría a días de 24 h).
function horasLegibles(horas: number): string {
  return `${(Math.round(horas * 10) / 10).toLocaleString('es-CO')} h`
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
  const { areaActiva, areas } = useArea()

  // Área: la activa, otra que la persona lidere o todas las que lidera. Solo
  // las que lidera (el superadmin, todas): en un área donde es agente RLS
  // solo le devuelve lo suyo y las cifras saldrían incompletas.
  const [filtroArea, setFiltroArea] = useState('')
  const opcionesArea = useMemo(() => {
    const lideradas = areas.filter((a) => a.rol === 'lider')
    return areaActiva && !lideradas.some((a) => a.id === areaActiva.id) ? [areaActiva, ...lideradas] : lideradas
  }, [areas, areaActiva])
  const idsAreas = filtroArea === 'todas'
    ? opcionesArea.map((a) => a.id)
    : [filtroArea || areaActiva?.id].filter((id): id is string => !!id)
  // Texto estable para las dependencias de los efectos (el arreglo cambia en cada render).
  const claveAreas = idsAreas.join(',')
  const nombreAreas = filtroArea === 'todas'
    ? 'Todas mis áreas'
    : opcionesArea.find((a) => a.id === idsAreas[0])?.nombre ?? areaActiva?.nombre ?? ''

  const [filtroProyecto, setFiltroProyecto] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<Estado | ''>('')
  const [filtroRango, setFiltroRango] = useState<RangoFecha>('todo')
  const [rangoPersonalizado, setRangoPersonalizado] = useState<RangoPersonalizado>({ desde: '', hasta: '' })
  // Por nombre, como se muestran (incluye "Bandeja general" para las sin asignar).
  const [filtroResponsable, setFiltroResponsable] = useState('')
  const [filtroEmpresa, setFiltroEmpresa] = useState('')

  // Pestaña abierta; se recuerda entre visitas. Los filtros son de todas.
  const [vista, setVista] = useState<Vista>(leerVista)
  function cambiarVista(nueva: Vista) {
    setVista(nueva)
    try {
      localStorage.setItem(VISTA_KEY, nueva)
    } catch {
      // Sin almacenamiento solo se pierde la preferencia entre visitas.
    }
  }

  useEffect(() => {
    if (!claveAreas) return
    let vigente = true
    setLoading(true)
    supabase
      .from('tickets')
      .select(TICKET_SELECT)
      .in('area_id', claveAreas.split(','))
      .then(({ data }) => {
        if (!vigente) return
        setTickets((data as unknown as TicketConRelaciones[]) ?? [])
        setLoading(false)
      })
    return () => {
      vigente = false
    }
  }, [claveAreas])

  // Los proyectos salen de las tareas cargadas: así sirve para varias áreas.
  const proyectos = useMemo(() => {
    const porId = new Map<string, string>()
    for (const t of tickets) if (t.proyecto) porId.set(t.proyecto.id, t.proyecto.nombre)
    return [...porId.entries()]
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [tickets])

  // Aparte de los tickets: si falla (p. ej. sin la migración 0042), las
  // estadísticas siguen y las horas salen solo de los tickets.
  const [subtareas, setSubtareas] = useState<SubtareaHoras[]>([])
  useEffect(() => {
    if (!claveAreas) return
    let vigente = true
    void supabase
      .from('ticket_subtareas')
      .select('ticket_id, titulo, tiempo_ejecutado_horas, responsable:profiles!ticket_subtareas_responsable_id_fkey(full_name, email), ticket:tickets!inner(area_id)')
      .in('ticket.area_id', claveAreas.split(','))
      .then(({ data, error }) => {
        if (!vigente) return
        if (error) console.error('No se pudieron cargar las subtareas:', error.message)
        setSubtareas((data as unknown as SubtareaHoras[] | null) ?? [])
      })
    return () => {
      vigente = false
    }
  }, [claveAreas])

  const subtareasPorTicket = useMemo(() => {
    const mapa = new Map<string, SubtareaHoras[]>()
    for (const s of subtareas) mapa.set(s.ticket_id, [...(mapa.get(s.ticket_id) ?? []), s])
    return mapa
  }, [subtareas])

  // Responsables de la tarea más los de sus subtareas.
  const personasDe = useMemo(() => (t: TicketConRelaciones) => [
    ...responsablesDe(t),
    ...(subtareasPorTicket.get(t.id) ?? []).map(responsableSubtarea),
  ], [subtareasPorTicket])

  const ticketsBase = useMemo(() => {
    return tickets.filter(
      (t) =>
        (!filtroProyecto || t.proyecto_id === filtroProyecto) &&
        (!filtroResponsable || personasDe(t).includes(filtroResponsable)) &&
        (!filtroEmpresa || t.empresa_solicitante === filtroEmpresa) &&
        dentroDeRango(t.created_at, filtroRango, rangoPersonalizado),
    )
  }, [tickets, personasDe, filtroProyecto, filtroResponsable, filtroEmpresa, filtroRango, rangoPersonalizado])

  const opcionesResponsable = useMemo(
    () => [...new Set(tickets.flatMap(personasDe))].sort((a, b) => a.localeCompare(b, 'es')),
    [tickets, personasDe],
  )

  const usuarios = useUsuariosActivos()
  // El filtro trabaja por nombre; el área sale del perfil con ese nombre
  // para dividir la lista (quien ya no está activo queda en "Sin área").
  const { personasResponsable, fijasResponsable } = useMemo(() => {
    const areaPorNombre = new Map(usuarios.map((u) => [nombreDe(u), u.area_id]))
    const personas: PersonaOpcion[] = []
    const fijas = [{ valor: '', etiqueta: 'Todos los responsables' }]
    for (const nombre of opcionesResponsable) {
      if (NO_SON_PERSONAS.has(nombre)) fijas.push({ valor: nombre, etiqueta: nombre })
      else personas.push({ id: nombre, full_name: nombre, email: '', area_id: areaPorNombre.get(nombre) ?? null })
    }
    return { personasResponsable: personas, fijasResponsable: fijas }
  }, [opcionesResponsable, usuarios])
  const opcionesEmpresa = useMemo(
    () => [...new Set(tickets.map((t) => t.empresa_solicitante).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')),
    [tickets],
  )

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

  // Cumplimiento de tiempos (migración 0041): semáforo de las abiertas,
  // cumplimiento de las finalizadas y retraso de las que se pasaron.
  const ahora = Date.now()
  const semaforos = ticketsFiltrados.map((t) => semaforo(t, ahora))
  const dentroDelTiempo = semaforos.filter((s) => s === 'verde').length
  const porVencer = semaforos.filter((s) => s === 'amarillo').length
  const vencidas = semaforos.filter((s) => s === 'rojo').length
  const cumplimientos = ticketsFiltrados.map(cumplioATiempo).filter((c): c is boolean => c !== null)
  const porcentajeCumplimiento = cumplimientos.length > 0
    ? Math.round((cumplimientos.filter(Boolean).length / cumplimientos.length) * 100)
    : null
  const retrasadas = ticketsFiltrados.filter((t) => horasDeRetraso(t, ahora) !== null)
  const retrasoPromedio = retrasadas.length > 0
    ? retrasadas.reduce((acc, t) => acc + horasDeRetraso(t, ahora)!, 0) / retrasadas.length
    : null
  const vencimientosPorProyecto = contarPor(retrasadas, (t) => t.proyecto?.nombre ?? null)

  // Horas invertidas (migración 0042). El tiempo de cada tarea ya es la suma
  // de sus subtareas, así que los totales salen de los tickets.
  const horasTotales = ticketsFiltrados.reduce((acc, t) => acc + (t.tiempo_ejecutado_horas ?? 0), 0)
  const horasEstimadas = ticketsFiltrados.reduce((acc, t) => acc + (t.tiempo_propuesto_horas ?? 0), 0)
  // Positiva: se ejecutó más de lo propuesto.
  const diferenciaHoras = horasTotales - horasEstimadas
  const desviacion = horasEstimadas > 0 ? Math.round((diferenciaHoras / horasEstimadas) * 100) : null
  // Cumplimiento del estimado: de las tareas con ambos tiempos, cuántas no
  // pasaron lo propuesto.
  const conAmbosTiempos = ticketsFiltrados.filter((t) => (t.tiempo_propuesto_horas ?? 0) > 0 && t.tiempo_ejecutado_horas != null)
  const dentroDelEstimado = conAmbosTiempos.filter((t) => t.tiempo_ejecutado_horas! <= t.tiempo_propuesto_horas!).length
  const cumplimientoEstimado = conAmbosTiempos.length > 0 ? Math.round((dentroDelEstimado / conAmbosTiempos.length) * 100) : null
  const ticketsConHoras = ticketsFiltrados.filter((t) => (t.tiempo_ejecutado_horas ?? 0) > 0)
  const promedioPorTicket = ticketsConHoras.length > 0 ? horasTotales / ticketsConHoras.length : null
  const horasColaborador = horasPorPersona(ticketsFiltrados, subtareasPorTicket)
  // Sin "Bandeja general" ni "Sin responsable": no son personas.
  const colaboradores = horasColaborador.filter((d) => !NO_SON_PERSONAS.has(d.nombre))
  const promedioPorColaborador = colaboradores.length > 0
    ? colaboradores.reduce((acc, d) => acc + d.total, 0) / colaboradores.length
    : null
  const horasProyecto = sumarPor(ticketsFiltrados, (t) => t.proyecto?.nombre ?? null, (t) => t.tiempo_ejecutado_horas)
  const horasEmpresa = sumarPor(ticketsFiltrados, (t) => t.empresa_solicitante || null, (t) => t.tiempo_ejecutado_horas)
  const ticketsMasHoras = sumarPor(ticketsFiltrados, (t) => `#${t.numero} ${t.titulo}`, (t) => t.tiempo_ejecutado_horas, 10)
  const subtareasFiltradas = ticketsFiltrados.flatMap((t) => (subtareasPorTicket.get(t.id) ?? []).map((s) => ({ ...s, numero: t.numero })))
  const subtareasMasHoras = sumarPor(subtareasFiltradas, (s) => `${s.titulo} (#${s.numero})`, (s) => s.tiempo_ejecutado_horas, 10)

  // Ejecutadas y propuestas por periodo (fecha de creación de la tarea).
  const porPeriodo = new Map<string, { ejecutadas: number; propuestas: number }>()
  for (const t of ticketsFiltrados) {
    if (t.tiempo_ejecutado_horas == null && t.tiempo_propuesto_horas == null) continue
    const clave = claveFecha(new Date(t.created_at), agrupacionTendencia)
    const punto = porPeriodo.get(clave) ?? { ejecutadas: 0, propuestas: 0 }
    punto.ejecutadas += t.tiempo_ejecutado_horas ?? 0
    punto.propuestas += t.tiempo_propuesto_horas ?? 0
    porPeriodo.set(clave, punto)
  }
  const tendenciaHoras = [...porPeriodo.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodo, valores]) => ({
      periodo,
      ejecutadas: Math.round(valores.ejecutadas * 10) / 10,
      propuestas: Math.round(valores.propuestas * 10) / 10,
    }))

  const hayFiltros = filtroProyecto !== '' || filtroEstado !== '' || filtroRango !== 'todo'
    || filtroResponsable !== '' || filtroEmpresa !== '' || filtroArea !== ''

  return (
    <div className="stats-page">
      <div className="board-page__toolbar">
        <div className="board-page__encabezado">
          <p className="board-page__eyebrow">Estadísticas</p>
          <h1>{nombreAreas}</h1>
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

      <div className="board-page__filtros board-page__filtros--barra stats-filtros">
        <div className="stats-filtros__grupo">
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
        </div>
        <div className="stats-filtros__grupo stats-filtros__grupo--derecha">
          {opcionesArea.length > 1 && (
            <select
              value={filtroArea || areaActiva?.id || ''}
              onChange={(e) => {
                setFiltroArea(e.target.value === areaActiva?.id ? '' : e.target.value)
                // Los proyectos son de cada área.
                setFiltroProyecto('')
              }}
              aria-label="Filtrar por área"
            >
              {opcionesArea.map((area) => (
                <option key={area.id} value={area.id}>{area.nombre}</option>
              ))}
              <option value="todas">Todas mis áreas</option>
            </select>
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
          <SelectorPersona
            className="stats-page__select-persona"
            personas={personasResponsable}
            valor={filtroResponsable}
            onCambiar={setFiltroResponsable}
            opcionesFijas={fijasResponsable}
            placeholder="Todos los responsables"
            aria-label="Filtrar por responsable"
          />
          <select value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)} aria-label="Filtrar por empresa">
            <option value="">Todas las empresas</option>
            {opcionesEmpresa.map((empresa) => (
              <option key={empresa} value={empresa}>{empresa}</option>
            ))}
          </select>
          {hayFiltros && (
            <button
              type="button"
              className="board-page__limpiar"
              onClick={() => {
                setFiltroArea('')
                setFiltroProyecto('')
                setFiltroEstado('')
                setFiltroResponsable('')
                setFiltroEmpresa('')
                setFiltroRango('todo')
                setRangoPersonalizado({ desde: '', hasta: '' })
              }}
            >
              Limpiar
            </button>
          )}
        </div>
      </div>

      <div className="pestanas stats-pestanas" role="tablist" aria-label="Vista de estadísticas">
        {VISTAS.map((v) => (
          <button
            key={v.valor}
            type="button"
            role="tab"
            id={`stats-pestana-${v.valor}`}
            aria-selected={vista === v.valor}
            aria-controls="stats-panel"
            className={`pestana${vista === v.valor ? ' pestana--activa' : ''}`}
            onClick={() => cambiarVista(v.valor)}
          >
            {v.etiqueta}
            {v.valor === 'cumplimiento' && vencidas > 0 && (
              <span className="pestana__contador pestana__contador--alerta" title={`${vencidas} vencidas`}>{vencidas}</span>
            )}
          </button>
        ))}
      </div>

      <div id="stats-panel" role="tabpanel" aria-labelledby={`stats-pestana-${vista}`}>
        {vista === 'resumen' && (
          <>
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
          </>
        )}

        {vista === 'horas' && (
          <section className="stats-seccion" aria-label="Horas invertidas">
            <p className="stats-seccion__nota">
              Tiempo ejecutado y propuesto de las tareas. En las que tienen subtareas, cada hora cuenta para el responsable de su subtarea.
            </p>
            <div className="stat-tiles">
              <div className="stat-tile">
                <p className="stat-tile__label">Horas ejecutadas acumuladas</p>
                <p className="stat-tile__value">{horasLegibles(horasTotales)}</p>
              </div>
              <div className="stat-tile">
                <p className="stat-tile__label">Horas propuestas acumuladas</p>
                <p className="stat-tile__value">{horasEstimadas > 0 ? horasLegibles(horasEstimadas) : '—'}</p>
              </div>
              <div
                className={`stat-tile${horasEstimadas === 0 ? '' : diferenciaHoras > 0 ? ' stat-tile--rechazado' : ' stat-tile--finalizado'}`}
                title={desviacion !== null ? `${desviacion > 0 ? '+' : ''}${desviacion} % frente a lo propuesto` : 'Sin horas propuestas'}
              >
                <p className="stat-tile__label">Diferencia (ejecutado − propuesto)</p>
                <p className="stat-tile__value">
                  {horasEstimadas > 0 ? `${diferenciaHoras > 0 ? '+' : diferenciaHoras < 0 ? '−' : ''}${horasLegibles(Math.abs(diferenciaHoras))}` : '—'}
                </p>
              </div>
              <div className="stat-tile" title={`${dentroDelEstimado} de ${conAmbosTiempos.length} tareas con ambos tiempos no pasaron lo propuesto`}>
                <p className="stat-tile__label">Cumplimiento del tiempo estimado</p>
                <p className="stat-tile__value">{cumplimientoEstimado !== null ? `${cumplimientoEstimado} %` : '—'}</p>
              </div>
              <div className="stat-tile" title={`Entre ${ticketsConHoras.length} tareas con horas ejecutadas`}>
                <p className="stat-tile__label">Promedio por tarea</p>
                <p className="stat-tile__value">{promedioPorTicket !== null ? horasLegibles(promedioPorTicket) : '—'}</p>
              </div>
              <div className="stat-tile" title={`Entre ${colaboradores.length} colaboradores con horas`}>
                <p className="stat-tile__label">Promedio por colaborador</p>
                <p className="stat-tile__value">{promedioPorColaborador !== null ? horasLegibles(promedioPorColaborador) : '—'}</p>
              </div>
            </div>
            <div className="charts-grid">
              <div className="chart-card chart-card--ancho">
                <h2>Horas ejecutadas vs. propuestas por {agrupacionTendencia === 'mes' ? 'mes' : 'día'}</h2>
                <LineaTendencia
                  datos={tendenciaHoras}
                  formatearEtiqueta={(periodo) => formatearEtiquetaPeriodo(periodo, agrupacionTendencia)}
                  series={[
                    { clave: 'ejecutadas', nombre: 'Ejecutadas', color: 'var(--series-1)' },
                    { clave: 'propuestas', nombre: 'Propuestas', color: 'var(--text-muted)', punteada: true },
                  ]}
                  unidad="h"
                />
              </div>
              <div className="chart-card">
                <h2>Ranking de horas por colaborador</h2>
                <RankingLista datos={horasColaborador} />
              </div>
              <div className="chart-card">
                <h2>Distribución de horas por colaborador</h2>
                <DonutChart datos={horasColaborador} centroEtiqueta="Horas" />
              </div>
              <div className="chart-card">
                <h2>Tareas con mayor consumo de horas</h2>
                <RankingLista datos={ticketsMasHoras} />
              </div>
              <div className="chart-card">
                <h2>Subtareas con más horas</h2>
                <RankingLista datos={subtareasMasHoras} />
              </div>
              <div className="chart-card">
                <h2>Horas por proyecto</h2>
                <BarraHorizontal datos={horasProyecto} />
              </div>
              <div className="chart-card">
                <h2>Horas por empresa solicitante</h2>
                <BarraHorizontal datos={horasEmpresa} />
              </div>
            </div>
          </section>
        )}

        {vista === 'cumplimiento' && (
          <section className="stats-seccion" aria-label="Cumplimiento de tiempos">
            <p className="stats-seccion__nota">
              Se mide contra la fecha compromiso o, si no la hay, contra la fecha que pidió el solicitante.
            </p>
            <div className="stat-tiles">
              <div className="stat-tile stat-tile--semaforo-verde">
                <p className="stat-tile__label"><span className="semaforo__punto" aria-hidden="true" /> Dentro del tiempo</p>
                <p className="stat-tile__value">{dentroDelTiempo}</p>
              </div>
              <div className="stat-tile stat-tile--semaforo-amarillo">
                <p className="stat-tile__label"><span className="semaforo__punto" aria-hidden="true" /> Próximas a vencer</p>
                <p className="stat-tile__value">{porVencer}</p>
              </div>
              <div className="stat-tile stat-tile--semaforo-rojo">
                <p className="stat-tile__label"><span className="semaforo__punto" aria-hidden="true" /> Vencidas</p>
                <p className="stat-tile__value">{vencidas}</p>
              </div>
              <div className="stat-tile" title={`${cumplimientos.filter(Boolean).length} de ${cumplimientos.length} finalizadas con fecha se terminaron a tiempo`}>
                <p className="stat-tile__label">Cumplimiento de SLA</p>
                <p className="stat-tile__value">{porcentajeCumplimiento !== null ? `${porcentajeCumplimiento} %` : '—'}</p>
              </div>
              <div className="stat-tile" title="Promedio entre las finalizadas tarde y las abiertas ya vencidas">
                <p className="stat-tile__label">Retraso promedio</p>
                <p className="stat-tile__value">{retrasoPromedio !== null ? formatearDuracion(retrasoPromedio) : '—'}</p>
              </div>
            </div>
            <div className="charts-grid">
              <div className="chart-card">
                <h2>Proyectos con más vencimientos</h2>
                <RankingLista datos={vencimientosPorProyecto} />
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
