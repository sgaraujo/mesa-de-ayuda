import type { Ticket } from '../types/database'

// Semáforo de vencimiento (migración 0041). Las mismas horas usa
// revisar_vencimientos() para las alertas: si cambian aquí, cambian allá.
export const HORAS_PROXIMO_A_VENCER = 24

export type Semaforo = 'verde' | 'amarillo' | 'rojo'

type TicketVencimiento = Pick<Ticket, 'estado' | 'fecha_compromiso' | 'fecha_requerida' | 'finalizado_at'>

const HORA_MS = 60 * 60 * 1000

// La fecha contra la que se mide: la que comprometió el equipo o, si no
// hay, la que pidió el solicitante.
export function fechaObjetivo(ticket: Pick<Ticket, 'fecha_compromiso' | 'fecha_requerida'>): string | null {
  return ticket.fecha_compromiso ?? ticket.fecha_requerida
}

export function estaAbierta(ticket: Pick<Ticket, 'estado'>): boolean {
  return ticket.estado === 'pendiente' || ticket.estado === 'en_curso'
}

// Solo para tareas abiertas con fecha objetivo; null en los demás casos.
export function semaforo(ticket: TicketVencimiento, ahora = Date.now()): Semaforo | null {
  const objetivo = fechaObjetivo(ticket)
  if (!objetivo || !estaAbierta(ticket)) return null
  const restante = new Date(objetivo).getTime() - ahora
  if (restante <= 0) return 'rojo'
  if (restante <= HORAS_PROXIMO_A_VENCER * HORA_MS) return 'amarillo'
  return 'verde'
}

// Finalizada con fecha objetivo: ¿se terminó a tiempo? null si no aplica.
export function cumplioATiempo(ticket: TicketVencimiento): boolean | null {
  const objetivo = fechaObjetivo(ticket)
  if (!objetivo || ticket.estado !== 'finalizado' || !ticket.finalizado_at) return null
  return new Date(ticket.finalizado_at).getTime() <= new Date(objetivo).getTime()
}

// Horas de retraso: de una finalizada tarde, o de una abierta ya vencida
// (hasta ahora). null si no está retrasada.
export function horasDeRetraso(ticket: TicketVencimiento, ahora = Date.now()): number | null {
  const objetivo = fechaObjetivo(ticket)
  if (!objetivo) return null
  const limite = new Date(objetivo).getTime()
  const fin = ticket.estado === 'finalizado' && ticket.finalizado_at
    ? new Date(ticket.finalizado_at).getTime()
    : estaAbierta(ticket) ? ahora : null
  if (fin == null || fin <= limite) return null
  return (fin - limite) / HORA_MS
}

// "en 3 h", "hace 2 d"…
export function tiempoRelativo(iso: string, ahora = Date.now()): string {
  const minutos = Math.round((new Date(iso).getTime() - ahora) / 60000)
  const absoluto = Math.abs(minutos)
  const texto = absoluto < 60 ? `${absoluto} min` : absoluto < 48 * 60 ? `${Math.round(absoluto / 60)} h` : `${Math.round(absoluto / 1440)} d`
  return minutos >= 0 ? `en ${texto}` : `hace ${texto}`
}
