import { useDraggable } from '@dnd-kit/core'
import { clasificacionFaltante, nombresAsignados } from '../lib/ticket'
import { Avatar } from './Avatar'
import type { TicketConRelaciones } from '../types/database'

const PRIORIDAD_LABEL: Record<string, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
}

const MAX_AVATARES = 3

function formatearDia(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

function formatearFechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatearTiempo(horas: number): string {
  const minutosTotales = Math.round(horas * 60)
  const horasEnteras = Math.floor(minutosTotales / 60)
  const minutos = minutosTotales % 60
  return [horasEnteras ? `${horasEnteras}h` : '', minutos ? `${minutos}m` : ''].filter(Boolean).join(' ') || '0m'
}

function Icono({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const ICONO_CALENDARIO = 'M8 3v3M16 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z'
const ICONO_RELOJ = 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'
const ICONO_COMENTARIO = 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z'
const ICONO_CHECK = 'M20 6 9 17l-5-5'

interface TicketCardProps {
  ticket: TicketConRelaciones
  onClick?: () => void
  puedeArrastrar?: boolean
  // En el tablero general (todas las áreas) cada tarjeta muestra su área.
  mostrarArea?: boolean
}

export function TicketCard({ ticket, onClick, puedeArrastrar = true, mostrarArea = false }: TicketCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: ticket.id,
    disabled: !puedeArrastrar,
  })

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined
  const faltan = clasificacionFaltante(ticket)
  const totalComentarios = ticket.comentarios?.[0]?.count ?? 0
  const asignados = nombresAsignados(ticket)
  const finalizada = ticket.estado === 'finalizado'
  const vencida = !finalizada && ticket.fecha_requerida !== null && new Date(ticket.fecha_requerida).getTime() < Date.now()

  const clases = [
    'ticket-card',
    `ticket-card--${ticket.prioridad}`,
    faltan.length > 0 && 'ticket-card--sin-clasificar',
    isDragging && 'ticket-card--arrastrando',
  ].filter(Boolean).join(' ')

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(puedeArrastrar ? listeners : {})}
      {...(puedeArrastrar ? attributes : {})}
      onClick={onClick}
      className={clases}
    >
      <div className="ticket-card__header">
        <span className="ticket-card__numero">#{ticket.numero}</span>
        <span className={`ticket-card__prioridad ticket-card__prioridad--${ticket.prioridad}`}>
          {PRIORIDAD_LABEL[ticket.prioridad]}
        </span>
      </div>

      <h3 className="ticket-card__titulo">{ticket.titulo}</h3>
      {ticket.descripcion && <p className="ticket-card__descripcion">{ticket.descripcion}</p>}

      {(ticket.proyecto || ticket.es_grupal || (mostrarArea && ticket.area)) && (
        <div className="ticket-card__etiquetas">
          {mostrarArea && ticket.area && (
            <span className="ticket-card__etiqueta ticket-card__etiqueta--area">{ticket.area.nombre}</span>
          )}
          {ticket.proyecto && (
            <span className="ticket-card__etiqueta" title={`Proyecto · ${ticket.area?.nombre ?? ''}`}>
              {ticket.proyecto.nombre}
            </span>
          )}
          {ticket.es_grupal && <span className="ticket-card__etiqueta ticket-card__etiqueta--grupo">Grupo</span>}
        </div>
      )}

      {faltan.length > 0 && (
        <div className="ticket-card__aviso" role="status">
          Falta {faltan.join(' y ')}
        </div>
      )}

      <div className="ticket-card__footer">
        <div className="ticket-card__meta">
          {finalizada && ticket.finalizado_at ? (
            <span className="ticket-card__dato ticket-card__dato--ok" title={`Finalizada: ${formatearFechaHora(ticket.finalizado_at)}`}>
              <Icono d={ICONO_CHECK} />
              {formatearDia(ticket.finalizado_at)}
            </span>
          ) : ticket.fecha_requerida ? (
            <span
              className={`ticket-card__dato${vencida ? ' ticket-card__dato--vencida' : ''}`}
              title={`${vencida ? 'Vencida' : 'Para'}: ${formatearFechaHora(ticket.fecha_requerida)}`}
            >
              <Icono d={ICONO_CALENDARIO} />
              {formatearDia(ticket.fecha_requerida)}
            </span>
          ) : (
            <span className="ticket-card__dato" title={`Solicitada: ${formatearFechaHora(ticket.created_at)}`}>
              <Icono d={ICONO_CALENDARIO} />
              {formatearDia(ticket.created_at)}
            </span>
          )}
          {(ticket.tiempo_propuesto_horas != null || ticket.tiempo_ejecutado_horas != null) && (
            <span
              className="ticket-card__dato"
              title={`Ejecutado ${ticket.tiempo_ejecutado_horas != null ? formatearTiempo(ticket.tiempo_ejecutado_horas) : '—'} de ${ticket.tiempo_propuesto_horas != null ? formatearTiempo(ticket.tiempo_propuesto_horas) : '—'} propuesto`}
            >
              <Icono d={ICONO_RELOJ} />
              {ticket.tiempo_ejecutado_horas != null ? formatearTiempo(ticket.tiempo_ejecutado_horas) : '—'}
              {ticket.tiempo_propuesto_horas != null && <span className="ticket-card__dato-sutil">/{formatearTiempo(ticket.tiempo_propuesto_horas)}</span>}
            </span>
          )}
          {totalComentarios > 0 && (
            <span className="ticket-card__dato" title={`${totalComentarios} comentario${totalComentarios === 1 ? '' : 's'}`}>
              <Icono d={ICONO_COMENTARIO} />
              {totalComentarios}
            </span>
          )}
        </div>

        <div className="ticket-card__asignados" title={asignados.join(', ') || 'Sin asignar'}>
          {asignados.length === 0 ? (
            <span className="ticket-card__sin-asignar" aria-label="Sin asignar" />
          ) : (
            <>
              {asignados.slice(0, MAX_AVATARES).map((nombre) => (
                <Avatar key={nombre} nombre={nombre} tamano="sm" />
              ))}
              {asignados.length > MAX_AVATARES && (
                <span className="avatar avatar--sm ticket-card__mas">+{asignados.length - MAX_AVATARES}</span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
