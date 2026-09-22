import ExcelJS from 'exceljs'
import type { TicketConRelaciones } from '../types/database'
import { estaSinAsignar, nombresAsignados } from './ticket'

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
}

const PRIORIDAD_LABEL: Record<string, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function escaparCsv(valor: string): string {
  return /[",\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

function formatearFecha(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}

function construirCsv(encabezados: string[], filas: unknown[][]): string {
  return [encabezados, ...filas]
    .map((fila) => fila.map((valor) => escaparCsv(String(valor ?? ''))).join(','))
    .join('\r\n')
}

function descargarCsv(nombreArchivo: string, contenido: string) {
  const BOM = String.fromCharCode(0xfeff)
  const blob = new Blob([BOM + contenido], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombreArchivo
  enlace.click()
  URL.revokeObjectURL(url)
}

async function descargarExcel(nombreArchivo: string, encabezados: string[], filas: unknown[][]) {
  const workbook = new ExcelJS.Workbook()
  const hoja = workbook.addWorksheet('Reporte')

  hoja.addRow(encabezados)
  hoja.getRow(1).font = { bold: true }
  filas.forEach((fila) => hoja.addRow(fila))
  hoja.columns.forEach((columna) => {
    columna.width = 18
  })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombreArchivo
  enlace.click()
  URL.revokeObjectURL(url)
}

export function exportarTicketsCSV(tickets: TicketConRelaciones[]) {
  const encabezados = [
    'Título',
    'Solicitante',
    'Atendido por',
    'Estado',
    'Finalizado',
    'Fecha de finalización',
    'Nota de finalización',
  ]

  const filas = tickets.map((t) => [
    t.titulo,
    t.solicitante?.full_name ?? t.solicitante?.email ?? '',
    nombresAsignados(t).join(', ') || 'Bandeja general',
    ESTADO_LABEL[t.estado] ?? t.estado,
    t.estado === 'finalizado' ? 'Sí' : 'No',
    formatearFecha(t.finalizado_at),
    t.nota_finalizacion ?? '',
  ])

  descargarCsv(`tickets_${new Date().toISOString().slice(0, 10)}.csv`, construirCsv(encabezados, filas))
}

function columnaTablero(t: TicketConRelaciones): string {
  if (estaSinAsignar(t)) return 'Tareas (sin asignar)'
  return ESTADO_LABEL[t.estado] ?? t.estado
}

function emailsAsignados(t: TicketConRelaciones): string[] {
  if (t.es_grupal) return t.asignados.map((a) => a.profile.email)
  if (t.asignado) return [t.asignado.email]
  return []
}

function horasEntre(inicioIso: string, finIso: string): number {
  return (new Date(finIso).getTime() - new Date(inicioIso).getTime()) / (1000 * 60 * 60)
}

function numeroSemanaISO(fecha: Date): number {
  const copia = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()))
  const diaSemana = copia.getUTCDay() || 7
  copia.setUTCDate(copia.getUTCDate() + 4 - diaSemana)
  const inicioAnio = new Date(Date.UTC(copia.getUTCFullYear(), 0, 1))
  return Math.ceil(((copia.getTime() - inicioAnio.getTime()) / 86400000 + 1) / 7)
}

function rangoSemana(fecha: Date): string {
  const diaSemana = fecha.getDay() || 7
  const lunes = new Date(fecha)
  lunes.setDate(fecha.getDate() - diaSemana + 1)
  const domingo = new Date(lunes)
  domingo.setDate(lunes.getDate() + 6)
  const formato = (d: Date) => d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' })
  return `${formato(lunes)} - ${formato(domingo)}`
}

export async function exportarReporteDetalladoExcel(tickets: TicketConRelaciones[]) {
  const encabezados = [
    'ID de tarea',
    'Proyecto',
    'Columna',
    'Posición',
    'Creador',
    'Nombre del Creador',
    'Usuario(a) asignado',
    'Nombre del asignado',
    'Complejidad',
    'Título',
    'Fecha de creación',
    'Fecha de modificación',
    'Fecha de finalización',
    'Horas presupuestadas',
    'Horas ejecutadas',
    'Año',
    'Mes',
    'Mes letra',
    'Dia',
    'Sector',
    'Horas',
    'AVISO',
    'Semana',
    'Rango semana',
    'Fecha Y hora de actualizacion',
  ]

  const filas = tickets.map((t) => {
    const creado = new Date(t.created_at)
    return [
      t.id,
      t.proyecto?.nombre ?? '',
      columnaTablero(t),
      '',
      t.solicitante?.email ?? '',
      t.solicitante?.full_name ?? t.solicitante?.email ?? '',
      emailsAsignados(t).join(', '),
      nombresAsignados(t).join(', '),
      PRIORIDAD_LABEL[t.prioridad] ?? t.prioridad,
      t.titulo,
      formatearFecha(t.created_at),
      formatearFecha(t.updated_at),
      formatearFecha(t.finalizado_at),
      t.tiempo_propuesto_horas ?? '',
      t.tiempo_ejecutado_horas ?? '',
      creado.getFullYear(),
      creado.getMonth() + 1,
      MESES[creado.getMonth()],
      creado.getDate(),
      t.area?.nombre ?? '',
      t.finalizado_at ? horasEntre(t.created_at, t.finalizado_at).toFixed(1) : '',
      '',
      numeroSemanaISO(creado),
      rangoSemana(creado),
      formatearFecha(t.updated_at),
    ]
  })

  await descargarExcel(`reporte_tickets_${new Date().toISOString().slice(0, 10)}.xlsx`, encabezados, filas)
}
