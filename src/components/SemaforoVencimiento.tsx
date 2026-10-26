import { fechaObjetivo, semaforo, tiempoRelativo, type Semaforo } from '../lib/vencimiento'
import type { Ticket } from '../types/database'

const ETIQUETA: Record<Semaforo, string> = {
  verde: 'A tiempo',
  amarillo: 'Por vencer',
  rojo: 'Vencida',
}

function formatearFechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}

interface SemaforoVencimientoProps {
  ticket: Pick<Ticket, 'estado' | 'fecha_compromiso' | 'fecha_requerida' | 'finalizado_at'>
  // Sin texto de estado, solo el punto y el tiempo (tarjetas del tablero).
  compacto?: boolean
}

// Punto verde, amarillo o rojo con cuánto falta (o hace cuánto venció).
// No muestra nada si la tarea está cerrada o no tiene fecha.
export function SemaforoVencimiento({ ticket, compacto = false }: SemaforoVencimientoProps) {
  const color = semaforo(ticket)
  const objetivo = fechaObjetivo(ticket)
  if (!color || !objetivo) return null

  const vencida = color === 'rojo'
  const origen = ticket.fecha_compromiso ? 'Fecha compromiso' : 'Fecha requerida por el solicitante'
  return (
    <span
      className={`semaforo semaforo--${color}${compacto ? ' semaforo--compacto' : ''}`}
      title={`${ETIQUETA[color]} · ${origen}: ${formatearFechaHora(objetivo)}`}
    >
      <span className="semaforo__punto" aria-hidden="true" />
      {!compacto && <strong>{ETIQUETA[color]}</strong>}
      <span>{vencida ? `venció ${tiempoRelativo(objetivo)}` : `vence ${tiempoRelativo(objetivo)}`}</span>
    </span>
  )
}
