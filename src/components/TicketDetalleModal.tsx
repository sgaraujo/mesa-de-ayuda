import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAreas } from '../hooks/useAreas'
import { useProyectos } from '../hooks/useProyectos'
import type { TicketConRelaciones } from '../types/database'

const PRIORIDAD_LABEL: Record<string, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
}

function formatearFecha(iso: string | null): string {
  if (!iso) return 'Sin definir'
  return new Date(iso).toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

interface TicketDetalleModalProps {
  ticket: TicketConRelaciones
  puedeEditarTiempos: boolean
  onClose: () => void
  onGuardado: (ticket: TicketConRelaciones) => void
}

export function TicketDetalleModal({
  ticket,
  puedeEditarTiempos,
  onClose,
  onGuardado,
}: TicketDetalleModalProps) {
  const { areas } = useAreas()
  const { proyectos, recargar: recargarProyectos } = useProyectos()

  const [areaId, setAreaId] = useState(ticket.area_id ?? '')
  const [proyectoId, setProyectoId] = useState(ticket.proyecto_id ?? '')
  const [nuevoProyecto, setNuevoProyecto] = useState('')
  const [tiempoPropuesto, setTiempoPropuesto] = useState(
    ticket.tiempo_propuesto_horas?.toString() ?? '',
  )
  const [tiempoEjecutado, setTiempoEjecutado] = useState(
    ticket.tiempo_ejecutado_horas?.toString() ?? '',
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGuardar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setGuardando(true)

    let proyectoIdFinal = proyectoId || null

    if (nuevoProyecto.trim()) {
      const { data: creado, error: errorProyecto } = await supabase
        .from('proyectos')
        .insert({ nombre: nuevoProyecto.trim() })
        .select()
        .single()

      if (errorProyecto || !creado) {
        setGuardando(false)
        setError('No se pudo crear el proyecto nuevo.')
        return
      }
      proyectoIdFinal = creado.id
      await recargarProyectos()
    }

    const { data, error } = await supabase
      .from('tickets')
      .update({
        area_id: areaId || null,
        proyecto_id: proyectoIdFinal,
        tiempo_propuesto_horas: tiempoPropuesto ? Number(tiempoPropuesto) : null,
        tiempo_ejecutado_horas: tiempoEjecutado ? Number(tiempoEjecutado) : null,
      })
      .eq('id', ticket.id)
      .select()
      .single()

    setGuardando(false)
    if (error || !data) {
      setError('No se pudo guardar. Intenta de nuevo.')
      return
    }

    const areaActualizada = areas.find((a) => a.id === data.area_id) ?? null
    const proyectoActualizado = data.proyecto_id
      ? (proyectos.find((p) => p.id === data.proyecto_id) ??
        (nuevoProyecto.trim() ? { id: data.proyecto_id, nombre: nuevoProyecto.trim() } : ticket.proyecto))
      : null

    onGuardado({ ...ticket, ...data, area: areaActualizada, proyecto: proyectoActualizado })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-panel__header">
          <span className={`badge badge--prioridad-${ticket.prioridad}`}>
            {PRIORIDAD_LABEL[ticket.prioridad]}
          </span>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        <h2>{ticket.titulo}</h2>
        <p className="modal-descripcion">{ticket.descripcion}</p>

        <dl className="modal-detalles">
          <dt>Solicitante</dt>
          <dd>{ticket.solicitante?.full_name ?? ticket.solicitante?.email ?? '—'}</dd>

          <dt>Empresa</dt>
          <dd>{ticket.empresa_solicitante}</dd>

          <dt>Asignado a</dt>
          <dd>{ticket.asignado?.full_name ?? ticket.asignado?.email ?? 'Bandeja general'}</dd>

          <dt>Para cuándo se necesita</dt>
          <dd>{formatearFecha(ticket.fecha_requerida)}</dd>

          {!puedeEditarTiempos && (
            <>
              <dt>Área</dt>
              <dd>{ticket.area?.nombre ?? 'Sin definir'}</dd>
              <dt>Proyecto</dt>
              <dd>{ticket.proyecto?.nombre ?? 'Sin definir'}</dd>
              <dt>Tiempo propuesto</dt>
              <dd>{ticket.tiempo_propuesto_horas ? `${ticket.tiempo_propuesto_horas} h` : 'Sin definir'}</dd>
              <dt>Tiempo ejecutado</dt>
              <dd>{ticket.tiempo_ejecutado_horas ? `${ticket.tiempo_ejecutado_horas} h` : 'Sin definir'}</dd>
            </>
          )}
        </dl>

        {puedeEditarTiempos && (
          <form onSubmit={handleGuardar} className="modal-tiempos-form">
            <div className="ticket-form__row">
              <label>
                Área
                <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
                  <option value="">Sin definir</option>
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Proyecto
                <select value={proyectoId} onChange={(e) => setProyectoId(e.target.value)}>
                  <option value="">Sin definir</option>
                  {proyectos.map((proyecto) => (
                    <option key={proyecto.id} value={proyecto.id}>
                      {proyecto.nombre}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              O crear un proyecto nuevo
              <input
                value={nuevoProyecto}
                onChange={(e) => setNuevoProyecto(e.target.value)}
                placeholder="ej. Proyecto Castilla"
              />
            </label>
            <div className="ticket-form__row">
              <label>
                Tiempo propuesto (horas)
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={tiempoPropuesto}
                  onChange={(e) => setTiempoPropuesto(e.target.value)}
                  placeholder="ej. 2"
                />
              </label>
              <label>
                Tiempo ejecutado (horas)
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={tiempoEjecutado}
                  onChange={(e) => setTiempoEjecutado(e.target.value)}
                  placeholder="ej. 3.5"
                />
              </label>
            </div>
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
