import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useArea } from '../context/AreaContext'
import { PantallaCarga } from '../components/PantallaCarga'
import {
  claveDia,
  claveFecha,
  contarPor,
  dentroDeRango,
  formatearDuracion,
  formatearEtiquetaPeriodo,
  sumarPor,
  type Agrupacion,
  type ConteoCategoria,
  type RangoFecha,
  type RangoPersonalizado,
} from '../lib/agregaciones'
import { actividadAproximada, cargarActividad, cargarPaginado, type FilaActividad } from '../lib/actividad'
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

// Reparte las horas del periodo de una tarea: con subtareas, en proporción a
// lo que lleva cada una (va a su responsable); sin subtareas, entre sus
// responsables por igual. El historial guarda las horas de la tarea, no de
// cada subtarea, por eso la proporción.
function repartirHoras(
  ticket: TicketConRelaciones,
  horas: number,
  subtareas: SubtareaHoras[],
): { subtarea: SubtareaHoras | null; nombre: string; horas: number }[] {
  if (!horas) return []
  const totalSubtareas = subtareas.reduce((acc, s) => acc + (s.tiempo_ejecutado_horas ?? 0), 0)
  if (subtareas.length > 0 && totalSubtareas > 0) {
    return subtareas
      .filter((s) => s.tiempo_ejecutado_horas)
      .map((s) => ({ subtarea: s, nombre: responsableSubtarea(s), horas: (horas * s.tiempo_ejecutado_horas!) / totalSubtareas }))
  }
  const nombres = responsablesDe(ticket)
  return nombres.map((nombre) => ({ subtarea: null, nombre, horas: horas / nombres.length }))
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

const DIAS_MAXIMOS_POR_DIA = 14
const DIAS_MAXIMOS_POR_SEMANA = 180

// La tendencia va por día en la última semana, por semana en los meses (el
// seguimiento semanal del trabajo) y por mes en lo largo o abierto, para que
// la gráfica no quede con cientos de puntos.
function agrupacionPara(rango: RangoFecha, personalizado: RangoPersonalizado): Agrupacion {
  if (rango === 'todo') return 'mes'
  if (rango === '7d') return 'dia'
  if (rango !== 'personalizado') return 'semana'
  if (!personalizado.desde || !personalizado.hasta) return 'mes'
  const dias = (new Date(personalizado.hasta).getTime() - new Date(personalizado.desde).getTime()) / 86400000
  if (dias <= DIAS_MAXIMOS_POR_DIA) return 'dia'
  return dias <= DIAS_MAXIMOS_POR_SEMANA ? 'semana' : 'mes'
}

const NOMBRE_AGRUPACION: Record<Agrupacion, string> = { dia: 'día', semana: 'semana', mes: 'mes' }

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
  // Proyecto de la base de RRHH que eligió quien pidió (Operación, migración 0056).
  const [filtroProyectoRrhh, setFiltroProyectoRrhh] = useState('')

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
    cargarPaginado<TicketConRelaciones>((desde, hasta) =>
      supabase
        .from('tickets')
        .select(TICKET_SELECT)
        .in('area_id', claveAreas.split(','))
        .order('id')
        .range(desde, hasta) as unknown as PromiseLike<{ data: TicketConRelaciones[] | null; error: { message: string } | null }>,
    )
      .catch((error: Error) => {
        console.error('No se pudieron cargar las tareas:', error.message)
        return [] as TicketConRelaciones[]
      })
      .then((filas) => {
        if (!vigente) return
        setTickets(filas)
        setLoading(false)
      })
    return () => {
      vigente = false
    }
  }, [claveAreas])

  // Movimiento y horas de cada tarea dentro del periodo (migración 0060), para
  // contar lo que se trabajó o cerró en él aunque se haya creado antes.
  const [actividad, setActividad] = useState<{ filas: FilaActividad[]; exacta: boolean } | null>(null)
  const { desde: rangoDesde, hasta: rangoHasta } = rangoPersonalizado
  useEffect(() => {
    if (!claveAreas) return
    let vigente = true
    setActividad(null)
    void cargarActividad(claveAreas.split(','), filtroRango, { desde: rangoDesde, hasta: rangoHasta }).then((resultado) => {
      if (vigente) setActividad(resultado)
    })
    return () => {
      vigente = false
    }
  }, [claveAreas, filtroRango, rangoDesde, rangoHasta])

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
    void cargarPaginado<SubtareaHoras>((desde, hasta) =>
      supabase
        .from('ticket_subtareas')
        .select('id, ticket_id, titulo, tiempo_ejecutado_horas, responsable:profiles!ticket_subtareas_responsable_id_fkey(full_name, email), ticket:tickets!inner(area_id)')
        .in('ticket.area_id', claveAreas.split(','))
        .order('id')
        .range(desde, hasta) as unknown as PromiseLike<{ data: SubtareaHoras[] | null; error: { message: string } | null }>,
    )
      .catch((error: Error) => {
        console.error('No se pudieron cargar las subtareas:', error.message)
        return [] as SubtareaHoras[]
      })
      .then((filas) => {
        if (vigente) setSubtareas(filas)
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

  // Todas las tareas que cumplen los filtros, sin mirar fechas: el periodo se
  // aplica después, por separado, a la creación, la actividad y el cierre.
  const ticketsBase = useMemo(() => {
    return tickets.filter(
      (t) =>
        (!filtroProyecto || t.proyecto_id === filtroProyecto) &&
        (!filtroResponsable || personasDe(t).includes(filtroResponsable)) &&
        (!filtroEmpresa || t.empresa_solicitante === filtroEmpresa) &&
        (!filtroProyectoRrhh || t.proyecto_rrhh === filtroProyectoRrhh),
    )
  }, [tickets, personasDe, filtroProyecto, filtroResponsable, filtroEmpresa, filtroProyectoRrhh])

  // Solo hay opciones (y el filtro solo se muestra) en áreas que piden el
  // proyecto de RRHH; en las demás nada cambia.
  const opcionesProyectoRrhh = useMemo(
    () => [...new Set(tickets.map((t) => t.proyecto_rrhh).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b, 'es')),
    [tickets],
  )

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

  if (loading) return <PantallaCarga mensaje="Cargando estadísticas..." />

  // ---- El periodo, visto de tres formas independientes ----
  const enPeriodo = (iso: string | null) => !!iso && dentroDeRango(iso, filtroRango, rangoPersonalizado)
  const filasActividad = actividad
    ? (actividad.exacta ? actividad.filas : actividadAproximada(ticketsFiltrados, filtroRango, rangoPersonalizado))
    : []
  const idsFiltrados = new Set(ticketsFiltrados.map((t) => t.id))
  const filasDelFiltro = filasActividad.filter((f) => idsFiltrados.has(f.ticket_id))

  // Horas del periodo por tarea y tareas con movimiento en él.
  const horasPeriodoPorTicket = new Map<string, number>()
  const idsActualizadas = new Set<string>()
  for (const f of filasDelFiltro) {
    if (f.horas) horasPeriodoPorTicket.set(f.ticket_id, (horasPeriodoPorTicket.get(f.ticket_id) ?? 0) + f.horas)
    if (f.actividad) idsActualizadas.add(f.ticket_id)
  }
  const horasPeriodo = (t: TicketConRelaciones) => horasPeriodoPorTicket.get(t.id) ?? 0

  const creadas = ticketsFiltrados.filter((t) => enPeriodo(t.created_at))
  const actualizadas = ticketsFiltrados.filter((t) => idsActualizadas.has(t.id))
  const actualizadasDeAntes = actualizadas.filter((t) => !enPeriodo(t.created_at)).length
  const finalizadasPeriodo = ticketsFiltrados.filter((t) => t.estado === 'finalizado' && enPeriodo(t.finalizado_at))
  // Trabajo del periodo: lo que se creó, se movió, se cerró o sumó horas en él.
  const gestionadas = ticketsFiltrados.filter(
    (t) => enPeriodo(t.created_at) || idsActualizadas.has(t.id) || enPeriodo(t.finalizado_at) || horasPeriodoPorTicket.has(t.id),
  )

  const pendientes = gestionadas.filter((t) => t.estado === 'pendiente').length
  const enCurso = gestionadas.filter((t) => t.estado === 'en_curso').length
  const rechazados = gestionadas.filter((t) => t.estado === 'rechazado').length
  // Creadas menos finalizadas: positivo = entra más trabajo del que se cierra.
  const balance = creadas.length - finalizadasPeriodo.length

  const promedioHoras =
    finalizadasPeriodo.length > 0
      ? finalizadasPeriodo.reduce((acc, t) => {
          const horas =
            (new Date(t.finalizado_at!).getTime() - new Date(t.created_at).getTime()) /
            (1000 * 60 * 60)
          return acc + horas
        }, 0) / finalizadasPeriodo.length
      : null

  const porAgente = contarPorPersonaAsignada(gestionadas)
  const porEmpresa = contarPor(creadas, (t) => t.empresa_solicitante)
  const porProyecto = contarPor(gestionadas, (t) => t.proyecto?.nombre ?? null)
  const porProyectoRrhh = contarPor(gestionadas, (t) => t.proyecto_rrhh ?? null)
  const porPersonaResuelto = contarPorPersonaAsignada(finalizadasPeriodo)
  const agrupacionTendencia = agrupacionPara(filtroRango, rangoPersonalizado)

  // Comparativo por periodo: cada tarea cuenta en la fecha de cada cosa que
  // le pasó (se creó, se movió, se cerró), no solo en la de creación.
  const puntos = new Map<string, { creados: number; resueltos: number; actualizados: Set<string>; horas: number }>()
  const punto = (clave: string) => {
    let p = puntos.get(clave)
    if (!p) puntos.set(clave, (p = { creados: 0, resueltos: 0, actualizados: new Set(), horas: 0 }))
    return p
  }
  for (const t of creadas) punto(claveFecha(new Date(t.created_at), agrupacionTendencia)).creados += 1
  for (const t of finalizadasPeriodo) punto(claveFecha(new Date(t.finalizado_at!), agrupacionTendencia)).resueltos += 1
  for (const f of filasDelFiltro) {
    const p = punto(claveDia(f.dia, agrupacionTendencia))
    if (f.actividad) p.actualizados.add(f.ticket_id)
    p.horas += f.horas
  }
  const periodosOrdenados = [...puntos.entries()].sort(([a], [b]) => a.localeCompare(b))
  const tendencia = periodosOrdenados.map(([periodo, p]) => ({
    periodo,
    creados: p.creados,
    resueltos: p.resueltos,
    actualizados: p.actualizados.size,
  }))
  const tendenciaHoras = periodosOrdenados
    .map(([periodo, p]) => ({ periodo, ejecutadas: Math.round(p.horas * 10) / 10 }))
    .filter((p) => p.ejecutadas !== 0)

  // Cumplimiento de tiempos (migración 0041): semáforo de las abiertas que se
  // trabajaron en el periodo, cumplimiento de las que se cerraron en él y
  // retraso de las que se pasaron.
  const ahora = Date.now()
  const semaforos = gestionadas.map((t) => semaforo(t, ahora))
  const dentroDelTiempo = semaforos.filter((s) => s === 'verde').length
  const porVencer = semaforos.filter((s) => s === 'amarillo').length
  const vencidas = semaforos.filter((s) => s === 'rojo').length
  const cumplimientos = finalizadasPeriodo.map(cumplioATiempo).filter((c): c is boolean => c !== null)
  const porcentajeCumplimiento = cumplimientos.length > 0
    ? Math.round((cumplimientos.filter(Boolean).length / cumplimientos.length) * 100)
    : null
  const retrasadas = gestionadas.filter((t) => horasDeRetraso(t, ahora) !== null)
  const retrasoPromedio = retrasadas.length > 0
    ? retrasadas.reduce((acc, t) => acc + horasDeRetraso(t, ahora)!, 0) / retrasadas.length
    : null
  const vencimientosPorProyecto = contarPor(retrasadas, (t) => t.proyecto?.nombre ?? null)

  // Horas (migraciones 0042 y 0060): las ejecutadas DENTRO del periodo, sin
  // importar cuándo se creó la tarea. La comparación con lo propuesto es de
  // las que se finalizaron en el periodo, con su tiempo completo.
  const horasTotales = ticketsFiltrados.reduce((acc, t) => acc + horasPeriodo(t), 0)
  const horasEstimadas = finalizadasPeriodo.reduce((acc, t) => acc + (t.tiempo_propuesto_horas ?? 0), 0)
  const horasEjecutadasFinalizadas = finalizadasPeriodo.reduce((acc, t) => acc + (t.tiempo_ejecutado_horas ?? 0), 0)
  // Positiva: se ejecutó más de lo propuesto.
  const diferenciaHoras = horasEjecutadasFinalizadas - horasEstimadas
  const desviacion = horasEstimadas > 0 ? Math.round((diferenciaHoras / horasEstimadas) * 100) : null
  const conAmbosTiempos = finalizadasPeriodo.filter((t) => (t.tiempo_propuesto_horas ?? 0) > 0 && t.tiempo_ejecutado_horas != null)
  const dentroDelEstimado = conAmbosTiempos.filter((t) => t.tiempo_ejecutado_horas! <= t.tiempo_propuesto_horas!).length
  const cumplimientoEstimado = conAmbosTiempos.length > 0 ? Math.round((dentroDelEstimado / conAmbosTiempos.length) * 100) : null
  const ticketsConHoras = ticketsFiltrados.filter((t) => horasPeriodo(t) > 0)
  const promedioPorTicket = ticketsConHoras.length > 0 ? horasTotales / ticketsConHoras.length : null

  const reparto = ticketsConHoras.flatMap((t) =>
    repartirHoras(t, horasPeriodo(t), subtareasPorTicket.get(t.id) ?? []).map((r) => ({ ...r, ticket: t })),
  )
  const horasColaborador = sumarPor(reparto, (r) => r.nombre, (r) => r.horas)
  // Sin "Bandeja general" ni "Sin responsable": no son personas.
  const colaboradores = horasColaborador.filter((d) => !NO_SON_PERSONAS.has(d.nombre))
  const promedioPorColaborador = colaboradores.length > 0
    ? colaboradores.reduce((acc, d) => acc + d.total, 0) / colaboradores.length
    : null
  const horasProyecto = sumarPor(ticketsConHoras, (t) => t.proyecto?.nombre ?? null, horasPeriodo)
  const horasProyectoRrhh = sumarPor(ticketsConHoras, (t) => t.proyecto_rrhh ?? null, horasPeriodo)
  const horasArea = sumarPor(ticketsConHoras, (t) => t.area?.nombre ?? null, horasPeriodo)
  const horasEmpresa = sumarPor(ticketsConHoras, (t) => t.empresa_solicitante || null, horasPeriodo)
  const ticketsMasHoras = sumarPor(ticketsConHoras, (t) => `#${t.numero} ${t.titulo}`, horasPeriodo, 10)
  const subtareasMasHoras = sumarPor(
    reparto.filter((r) => r.subtarea),
    (r) => `${r.subtarea!.titulo} (#${r.ticket.numero})`,
    (r) => r.horas,
    10,
  )

  const avisoAproximado = actividad === null ? (
    <p className="stats-aviso" role="status">Calculando la actividad y las horas del periodo…</p>
  ) : !actividad.exacta ? (
    <p className="stats-aviso" role="status">
      Cifras aproximadas: no se pudo leer el historial de cambios, así que cada tarea cuenta como actualizada
      en su última modificación y sus horas caen el día en que se finalizó.
    </p>
  ) : null

  const hayFiltros = filtroProyecto !== '' || filtroEstado !== '' || filtroRango !== 'todo'
    || filtroResponsable !== '' || filtroEmpresa !== '' || filtroArea !== '' || filtroProyectoRrhh !== ''

  return (
    <div className="stats-page">
      <div className="board-page__toolbar">
        <div className="board-page__encabezado">
          <p className="board-page__eyebrow">Estadísticas</p>
          <h1>{nombreAreas}</h1>
          <p className="board-page__subtitulo">
            {creadas.length} {creadas.length === 1 ? 'creada' : 'creadas'} · {actualizadas.length}{' '}
            {actualizadas.length === 1 ? 'actualizada' : 'actualizadas'} · {finalizadasPeriodo.length}{' '}
            {finalizadasPeriodo.length === 1 ? 'finalizada' : 'finalizadas'} en {describirPeriodo(filtroRango, rangoPersonalizado)}
          </p>
        </div>
        <div className="board-page__acciones">
          <button type="button" className="boton-secundario" onClick={() => exportarTicketsCSV(gestionadas)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
            </svg>
            CSV
          </button>
          <button type="button" className="boton-secundario" onClick={() => void exportarReporteDetalladoExcel(gestionadas)}>
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
                setFiltroProyectoRrhh('')
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
          {opcionesProyectoRrhh.length > 0 && (
            <select value={filtroProyectoRrhh} onChange={(e) => setFiltroProyectoRrhh(e.target.value)} aria-label="Filtrar por proyecto de RRHH">
              <option value="">Todos los proyectos RRHH</option>
              {opcionesProyectoRrhh.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
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
                setFiltroProyectoRrhh('')
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
          {avisoAproximado}
          <div className="stat-tiles">
            <div className="stat-tile" title="Solicitudes creadas dentro del periodo">
              <p className="stat-tile__label">Creadas</p>
              <p className="stat-tile__value">{creadas.length}</p>
            </div>
            <div className="stat-tile stat-tile--en_curso" title="Tuvieron algún cambio, cambio de estado o comentario dentro del periodo, sin importar cuándo se crearon">
              <p className="stat-tile__label">Actualizadas</p>
              <p className="stat-tile__value">{actualizadas.length}</p>
              {filtroRango !== 'todo' && (
                <p className="stat-tile__detalle">{actualizadasDeAntes} creadas antes del periodo</p>
              )}
            </div>
            <div className="stat-tile stat-tile--finalizado" title="Finalizadas dentro del periodo, sin importar cuándo se crearon">
              <p className="stat-tile__label">Finalizadas</p>
              <p className="stat-tile__value">{finalizadasPeriodo.length}</p>
            </div>
            <div
              className={`stat-tile${balance > 0 ? ' stat-tile--rechazado' : balance < 0 ? ' stat-tile--finalizado' : ''}`}
              title="Creadas menos finalizadas en el periodo. Positivo: entró más trabajo del que se cerró."
            >
              <p className="stat-tile__label">Balance (creadas − finalizadas)</p>
              <p className="stat-tile__value">{balance > 0 ? `+${balance}` : balance < 0 ? `−${Math.abs(balance)}` : '0'}</p>
            </div>
            <div className="stat-tile stat-tile--pendiente" title="Estado actual de las tareas trabajadas en el periodo">
              <p className="stat-tile__label">Siguen pendientes</p>
              <p className="stat-tile__value">{pendientes}</p>
            </div>
            <div className="stat-tile stat-tile--en_curso" title="Estado actual de las tareas trabajadas en el periodo">
              <p className="stat-tile__label">Siguen en curso</p>
              <p className="stat-tile__value">{enCurso}</p>
            </div>
            <div className="stat-tile stat-tile--rechazado" title="De las tareas trabajadas en el periodo">
              <p className="stat-tile__label">Rechazadas</p>
              <p className="stat-tile__value">{rechazados}</p>
            </div>
            <div className="stat-tile" title="De creación a finalización, entre las finalizadas en el periodo">
              <p className="stat-tile__label">Tiempo promedio de resolución</p>
              <p className="stat-tile__value">
                {promedioHoras !== null ? formatearDuracion(promedioHoras) : '—'}
              </p>
            </div>
          </div>

          <div className="charts-grid">
            <div className="chart-card chart-card--ancho">
              <h2>Creación vs. cierre por {NOMBRE_AGRUPACION[agrupacionTendencia]}</h2>
              <LineaTendencia
                datos={tendencia}
                formatearEtiqueta={(periodo) => formatearEtiquetaPeriodo(periodo, agrupacionTendencia)}
                series={[
                  { clave: 'creados', nombre: 'Creadas', color: 'var(--series-1)' },
                  { clave: 'resueltos', nombre: 'Finalizadas', color: 'var(--estado-finalizado)' },
                  { clave: 'actualizados', nombre: 'Actualizadas', color: 'var(--text-muted)', punteada: true },
                ]}
              />
            </div>
            <div className="chart-card">
              <h2>Tareas trabajadas por proyecto</h2>
              <RankingLista datos={porProyecto} />
            </div>
            {opcionesProyectoRrhh.length > 0 && (
              <div className="chart-card">
                <h2>Tareas trabajadas por proyecto (RRHH)</h2>
                <BarraHorizontal datos={porProyectoRrhh} />
              </div>
            )}
            <div className="chart-card">
              <h2>Finalizadas por persona</h2>
              <DonutChart datos={porPersonaResuelto} centroEtiqueta="Finalizadas" />
            </div>
            <div className="chart-card">
              <h2>Tareas trabajadas por persona asignada</h2>
              <BarraHorizontal datos={porAgente} />
            </div>
            <div className="chart-card">
              <h2>Solicitudes creadas por empresa</h2>
              <BarraHorizontal datos={porEmpresa} />
            </div>
          </div>
          </>
        )}

        {vista === 'horas' && (
          <section className="stats-seccion" aria-label="Horas invertidas">
            {avisoAproximado}
            <p className="stats-seccion__nota">
              Horas ejecutadas dentro del periodo, aunque la tarea se haya creado antes: cuentan el día en que se registraron.
              En las tareas con subtareas se reparten entre sus responsables según lo que lleva cada subtarea.
              Lo propuesto se compara con las tareas finalizadas en el periodo.
            </p>
            <div className="stat-tiles">
              <div className="stat-tile" title={`En ${ticketsConHoras.length} tareas`}>
                <p className="stat-tile__label">Horas ejecutadas en el periodo</p>
                <p className="stat-tile__value">{horasLegibles(horasTotales)}</p>
              </div>
              <div className="stat-tile" title={`Tiempo propuesto de las ${finalizadasPeriodo.length} tareas finalizadas en el periodo`}>
                <p className="stat-tile__label">Propuestas (finalizadas)</p>
                <p className="stat-tile__value">{horasEstimadas > 0 ? horasLegibles(horasEstimadas) : '—'}</p>
              </div>
              <div
                className={`stat-tile${horasEstimadas === 0 ? '' : diferenciaHoras > 0 ? ' stat-tile--rechazado' : ' stat-tile--finalizado'}`}
                title={desviacion !== null ? `${desviacion > 0 ? '+' : ''}${desviacion} % frente a lo propuesto` : 'Sin horas propuestas'}
              >
                <p className="stat-tile__label">Diferencia en finalizadas</p>
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
                <h2>Trabajo real: horas ejecutadas por {NOMBRE_AGRUPACION[agrupacionTendencia]}</h2>
                <LineaTendencia
                  datos={tendenciaHoras}
                  formatearEtiqueta={(periodo) => formatearEtiquetaPeriodo(periodo, agrupacionTendencia)}
                  series={[{ clave: 'ejecutadas', nombre: 'Ejecutadas', color: 'var(--series-1)' }]}
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
              {opcionesProyectoRrhh.length > 0 && (
                <div className="chart-card">
                  <h2>Horas por proyecto (RRHH)</h2>
                  <BarraHorizontal datos={horasProyectoRrhh} />
                </div>
              )}
              {idsAreas.length > 1 && (
                <div className="chart-card">
                  <h2>Horas por área</h2>
                  <BarraHorizontal datos={horasArea} />
                </div>
              )}
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
              El semáforo es de las tareas trabajadas en el periodo; el cumplimiento, de las finalizadas en él.
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
