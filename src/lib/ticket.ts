import type { TicketConRelaciones } from '../types/database'

export function nombresAsignados(ticket: TicketConRelaciones): string[] {
  if (ticket.es_grupal) {
    return ticket.asignados.map((a) => a.profile.full_name ?? a.profile.email)
  }
  if (ticket.asignado) {
    return [ticket.asignado.full_name ?? ticket.asignado.email]
  }
  return []
}

export function estaSinAsignar(ticket: TicketConRelaciones): boolean {
  return !ticket.es_grupal && ticket.asignado_a === null
}

// Una tarea finalizada debe quedar clasificada (proyecto, área y tiempo
// ejecutado) para que cuente bien en las estadísticas. Devuelve lo que le
// falta, vacío si nada.
export function clasificacionFaltante(ticket: TicketConRelaciones): string[] {
  if (ticket.estado !== 'finalizado') return []
  const faltan: string[] = []
  if (!ticket.proyecto_id) faltan.push('proyecto')
  if (!ticket.area_id) faltan.push('área')
  if (ticket.tiempo_ejecutado_horas == null) faltan.push('tiempo ejecutado')
  return faltan
}

const EXTENSIONES_IMAGEN = ['png', 'jpg', 'jpeg', 'webp', 'gif']

export function esImagenAdjunta(url: string): boolean {
  const extension = url.split('?')[0].split('.').pop()?.toLowerCase() ?? ''
  return EXTENSIONES_IMAGEN.includes(extension)
}

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

// "#42" busca solo por número; "42" busca el número exacto o el texto; cualquier
// otra cosa busca en título, descripción, personas, proyecto y área, sin
// distinguir mayúsculas ni tildes.
export function coincideBusqueda(ticket: TicketConRelaciones, busqueda: string): boolean {
  const termino = normalizar(busqueda.trim())
  if (!termino) return true

  const numero = termino.match(/^#\s*(\d+)$/)
  if (numero) return ticket.numero === Number(numero[1])
  if (/^\d+$/.test(termino) && ticket.numero === Number(termino)) return true

  const campos = [
    ticket.titulo,
    ticket.descripcion,
    ticket.solicitante?.full_name,
    ticket.solicitante?.email,
    ticket.proyecto?.nombre,
    ticket.area?.nombre,
    ticket.empresa_solicitante,
    ...nombresAsignados(ticket),
  ]
  return campos.some((campo) => campo != null && normalizar(campo).includes(termino))
}
