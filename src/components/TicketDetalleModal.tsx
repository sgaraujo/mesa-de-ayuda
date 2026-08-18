import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAreas } from '../hooks/useAreas'
import { useProyectos } from '../hooks/useProyectos'
import { useAgentes } from '../hooks/useAgentes'
import { esImagenAdjunta, nombresAsignados } from '../lib/ticket'
import { notificarAsignacion } from '../lib/notificaciones'
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

function separarTiempo(horas: number | null): [string, string] {
  if (horas == null) return ['', '']
  const minutosTotales = Math.round(horas * 60)
  return [String(Math.floor(minutosTotales / 60)), String(minutosTotales % 60)]
}

function combinarTiempo(horas: string, minutos: string): number | null {
  if (!horas && !minutos) return null
  return (Number(horas || 0) * 60 + Number(minutos || 0)) / 60
}

function formatearTiempo(horas: number | null): string {
  if (horas == null) return 'Sin definir'
  const minutosTotales = Math.round(horas * 60)
  const horasEnteras = Math.floor(minutosTotales / 60)
  const minutos = minutosTotales % 60
  return [horasEnteras ? `${horasEnteras} h` : '', minutos ? `${minutos} min` : ''].filter(Boolean).join(' ') || '0 min'
}

interface TicketDetalleModalProps {
  ticket: TicketConRelaciones
  puedeEditarTiempos: boolean
  puedeEliminar: boolean
  onClose: () => void
  onGuardado: (ticket: TicketConRelaciones) => void
  onEliminado: (ticketId: string) => void
}

export function TicketDetalleModal({
  ticket,
  puedeEditarTiempos,
  puedeEliminar,
  onClose,
  onGuardado,
  onEliminado,
}: TicketDetalleModalProps) {
  const { areas } = useAreas()
  const { proyectos, recargar: recargarProyectos } = useProyectos()
  const { agentes } = useAgentes()

  const [areaId, setAreaId] = useState(ticket.area_id ?? '')
  const [proyectoId, setProyectoId] = useState(ticket.proyecto_id ?? '')
  const [nuevoProyecto, setNuevoProyecto] = useState('')
  const [esGrupal, setEsGrupal] = useState(ticket.es_grupal)
  const [miembros, setMiembros] = useState<string[]>(ticket.asignados.map((a) => a.profile.id))
  const [propuestoInicialHoras, propuestoInicialMinutos] = separarTiempo(ticket.tiempo_propuesto_horas)
  const [ejecutadoInicialHoras, ejecutadoInicialMinutos] = separarTiempo(ticket.tiempo_ejecutado_horas)
  const [tiempoPropuestoHoras, setTiempoPropuestoHoras] = useState(propuestoInicialHoras)
  const [tiempoPropuestoMinutos, setTiempoPropuestoMinutos] = useState(propuestoInicialMinutos)
  const [tiempoEjecutadoHoras, setTiempoEjecutadoHoras] = useState(ejecutadoInicialHoras)
  const [tiempoEjecutadoMinutos, setTiempoEjecutadoMinutos] = useState(ejecutadoInicialMinutos)
  const [guardando, setGuardando] = useState(false)
  const [eliminando, setEliminando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function alternarMiembro(id: string) {
    setMiembros((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]))
  }

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
        es_grupal: esGrupal,
        asignado_a: esGrupal ? null : ticket.asignado_a,
        tiempo_propuesto_horas: combinarTiempo(tiempoPropuestoHoras, tiempoPropuestoMinutos),
        tiempo_ejecutado_horas: combinarTiempo(tiempoEjecutadoHoras, tiempoEjecutadoMinutos),
      })
      .eq('id', ticket.id)
      .select()
      .single()

    if (error || !data) {
      setGuardando(false)
      setError('No se pudo guardar. Intenta de nuevo.')
      return
    }

    await supabase.from('ticket_asignados').delete().eq('ticket_id', ticket.id)
    if (esGrupal && miembros.length > 0) {
      await supabase
        .from('ticket_asignados')
        .insert(miembros.map((profile_id) => ({ ticket_id: ticket.id, profile_id })))
    }

    const miembrosAnteriores = new Set(ticket.asignados.map((asignado) => asignado.profile.id))
    const miembrosNuevos = esGrupal ? miembros.filter((id) => !miembrosAnteriores.has(id)) : []
    if (miembrosNuevos.length > 0) void notificarAsignacion(ticket.id, miembrosNuevos)

    setGuardando(false)

    const areaActualizada = areas.find((a) => a.id === data.area_id) ?? null
    const proyectoActualizado = data.proyecto_id
      ? (proyectos.find((p) => p.id === data.proyecto_id) ??
        (nuevoProyecto.trim() ? { id: data.proyecto_id, nombre: nuevoProyecto.trim() } : ticket.proyecto))
      : null
    const asignadosActualizados = esGrupal
      ? agentes
          .filter((a) => miembros.includes(a.id))
          .map((a) => ({ profile: { id: a.id, full_name: a.full_name, email: a.email } }))
      : []

    onGuardado({
      ...ticket,
      ...data,
      area: areaActualizada,
      proyecto: proyectoActualizado,
      asignados: asignadosActualizados,
    })
  }

  async function handleEliminar() {
    if (!confirm('¿Eliminar esta solicitud de forma permanente? Esta acción no se puede deshacer.')) return
    setError(null)
    setEliminando(true)

    const { error: errorEliminar } = await supabase.from('tickets').delete().eq('id', ticket.id)

    if (errorEliminar) {
      setEliminando(false)
      setError('No se pudo eliminar. Intenta de nuevo.')
      return
    }

    onEliminado(ticket.id)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-panel__header">
          <span className={`badge badge--prioridad-${ticket.prioridad}`}>
            {PRIORIDAD_LABEL[ticket.prioridad]}
          </span>
          <div className="modal-panel__header-acciones">
            {puedeEliminar && (
              <button
                type="button"
                className="modal-eliminar"
                onClick={handleEliminar}
                disabled={eliminando}
              >
                {eliminando ? 'Eliminando...' : 'Eliminar'}
              </button>
            )}
            <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
              ×
            </button>
          </div>
        </div>

        <h2>{ticket.titulo}</h2>
        <p className="modal-descripcion">{ticket.descripcion}</p>

        {ticket.archivo_url && (
          esImagenAdjunta(ticket.archivo_url) ? (
            <a href={ticket.archivo_url} target="_blank" rel="noreferrer" className="modal-archivo-link">
              <img src={ticket.archivo_url} alt="Adjunto de la solicitud" className="modal-archivo-imagen" />
            </a>
          ) : (
            <a href={ticket.archivo_url} target="_blank" rel="noreferrer" className="modal-archivo-documento">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
                <path d="M14 3v5h5" />
              </svg>
              Ver archivo adjunto
            </a>
          )
        )}

        <dl className="modal-detalles">
          <dt>Solicitante</dt>
          <dd>{ticket.solicitante?.full_name ?? ticket.solicitante?.email ?? '—'}</dd>

          <dt>Empresa</dt>
          <dd>{ticket.empresa_solicitante}</dd>

          <dt>Asignado a</dt>
          <dd>{nombresAsignados(ticket).join(', ') || 'Bandeja general'}</dd>

          <dt>Para cuándo se necesita</dt>
          <dd>{formatearFecha(ticket.fecha_requerida)}</dd>

          {!puedeEditarTiempos && (
            <>
              <dt>Área</dt>
              <dd>{ticket.area?.nombre ?? 'Sin definir'}</dd>
              <dt>Proyecto</dt>
              <dd>{ticket.proyecto?.nombre ?? 'Sin definir'}</dd>
              <dt>Tiempo propuesto</dt>
              <dd>{formatearTiempo(ticket.tiempo_propuesto_horas)}</dd>
              <dt>Tiempo ejecutado</dt>
              <dd>{formatearTiempo(ticket.tiempo_ejecutado_horas)}</dd>
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

            <label className="modal-checkbox">
              <input
                type="checkbox"
                checked={esGrupal}
                onChange={(e) => setEsGrupal(e.target.checked)}
              />
              Es una tarea en grupo (varias personas)
            </label>

            {esGrupal && (
              <div className="modal-miembros">
                <p className="modal-miembros__label">Selecciona a las personas del grupo</p>
                <div className="modal-miembros__lista">
                  {agentes.map((agente) => (
                    <label key={agente.id} className="modal-checkbox">
                      <input
                        type="checkbox"
                        checked={miembros.includes(agente.id)}
                        onChange={() => alternarMiembro(agente.id)}
                      />
                      {agente.full_name ?? agente.email}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="ticket-form__row">
              <fieldset>
                <legend>Tiempo propuesto</legend>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={tiempoPropuestoHoras}
                  onChange={(e) => setTiempoPropuestoHoras(e.target.value)}
                  placeholder="Horas"
                  aria-label="Horas propuestas"
                />
                <input
                  type="number"
                  min="0"
                  max="59"
                  step="1"
                  value={tiempoPropuestoMinutos}
                  onChange={(e) => setTiempoPropuestoMinutos(e.target.value)}
                  placeholder="Minutos"
                  aria-label="Minutos propuestos"
                />
              </fieldset>
              <fieldset>
                <legend>Tiempo ejecutado</legend>
                <input type="number" min="0" step="1" value={tiempoEjecutadoHoras} onChange={(e) => setTiempoEjecutadoHoras(e.target.value)} placeholder="Horas" aria-label="Horas ejecutadas" />
                <input type="number" min="0" max="59" step="1" value={tiempoEjecutadoMinutos} onChange={(e) => setTiempoEjecutadoMinutos(e.target.value)} placeholder="Minutos" aria-label="Minutos ejecutados" />
              </fieldset>
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
