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
