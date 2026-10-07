import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useProyectos } from '../hooks/useProyectos'
import { useMiembrosArea } from '../hooks/useMiembrosArea'
import { clasificacionFaltante, esImagenAdjunta, nombresAsignados } from '../lib/ticket'
import { notificarAsignacion } from '../lib/notificaciones'
import { separarTiempo, combinarTiempo, formatearTiempo } from '../lib/tiempo'
import { ComentariosTicket } from './ComentariosTicket'
import { HistorialCambios } from './HistorialCambios'
import { Avatar } from './Avatar'
import type { Prioridad, TicketConRelaciones } from '../types/database'

const PRIORIDAD_LABEL: Record<string, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
}

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
}

function formatearFecha(iso: string | null): string {
  if (!iso) return 'Sin definir'
  return new Date(iso).toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

// <input type="datetime-local"> trabaja en hora local y sin zona horaria.
function aInputFecha(iso: string | null): string {
  if (!iso) return ''
  const fecha = new Date(iso)
  return new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

interface TicketDetalleModalProps {
  ticket: TicketConRelaciones
  puedeEditarTiempos: boolean
  puedeEliminar: boolean
  onClose: () => void
  onGuardado: (ticket: TicketConRelaciones) => void
  onEliminado: (ticketId: string) => void
  onComentado?: () => void
}

export function TicketDetalleModal({
  ticket,
  puedeEditarTiempos,
  puedeEliminar,
  onClose,
  onGuardado,
  onEliminado,
  onComentado,
}: TicketDetalleModalProps) {
  const areaId = ticket.area_id
  const { proyectos, recargar: recargarProyectos } = useProyectos(areaId)
  const { agentes } = useMiembrosArea(areaId)

  const [titulo, setTitulo] = useState(ticket.titulo)
  const [descripcion, setDescripcion] = useState(ticket.descripcion)
  const [prioridad, setPrioridad] = useState<Prioridad>(ticket.prioridad)
  const fechaRequeridaInicial = aInputFecha(ticket.fecha_requerida)
  const [fechaRequerida, setFechaRequerida] = useState(fechaRequeridaInicial)
  const [proyectoId, setProyectoId] = useState(ticket.proyecto_id ?? '')
  const [nuevoProyecto, setNuevoProyecto] = useState('')
  const [mostrarNuevoProyecto, setMostrarNuevoProyecto] = useState(false)
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
  const [pestana, setPestana] = useState<'comentarios' | 'historial'>('comentarios')

  function alternarMiembro(id: string) {
    setMiembros((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]))
  }

  async function handleGuardar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!titulo.trim() || !descripcion.trim()) {
      setError('El título y la descripción no pueden quedar vacíos.')
      return
    }
    setGuardando(true)

    let proyectoIdFinal = proyectoId || null

    if (nuevoProyecto.trim()) {
      const { data: creado, error: errorProyecto } = await supabase
        .from('proyectos')
        .insert({ nombre: nuevoProyecto.trim(), area_id: ticket.area_id })
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
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        prioridad,
        // Solo se reescribe si cambió, para no registrar en el historial una
        // diferencia de segundos que el input de fecha no muestra.
        fecha_requerida: fechaRequerida === fechaRequeridaInicial
          ? ticket.fecha_requerida
          : fechaRequerida ? new Date(fechaRequerida).toISOString() : null,
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

    // Solo se tocan las personas que entran o salen: cada alta y baja queda
    // en el historial de cambios (trigger en ticket_asignados).
    const miembrosAnteriores = new Set(ticket.asignados.map((asignado) => asignado.profile.id))
    const miembrosFinales = esGrupal ? miembros : []
    const miembrosQuitados = [...miembrosAnteriores].filter((id) => !miembrosFinales.includes(id))
    const miembrosNuevos = miembrosFinales.filter((id) => !miembrosAnteriores.has(id))
    if (miembrosQuitados.length > 0) {
      await supabase
        .from('ticket_asignados')
        .delete()
        .eq('ticket_id', ticket.id)
        .in('profile_id', miembrosQuitados)
    }
    if (miembrosNuevos.length > 0) {
      await supabase
        .from('ticket_asignados')
        .insert(miembrosNuevos.map((profile_id) => ({ ticket_id: ticket.id, profile_id })))
    }

    if (miembrosNuevos.length > 0) void notificarAsignacion(ticket.id, miembrosNuevos)

    setGuardando(false)

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

  const solicitanteNombre = ticket.solicitante?.full_name ?? ticket.solicitante?.email ?? 'Alguien'
  const asignados = nombresAsignados(ticket)
  const faltan = clasificacionFaltante(ticket)
  const totalComentarios = ticket.comentarios?.[0]?.count

  const tiempoPropuesto = combinarTiempo(tiempoPropuestoHoras, tiempoPropuestoMinutos)
  const tiempoEjecutado = combinarTiempo(tiempoEjecutadoHoras, tiempoEjecutadoMinutos)
  const avance = tiempoPropuesto && tiempoEjecutado != null ? tiempoEjecutado / tiempoPropuesto : null

  const miembrosIniciales = ticket.asignados.map((a) => a.profile.id)
  const hayCambios = puedeEditarTiempos && (
    titulo !== ticket.titulo
    || descripcion !== ticket.descripcion
    || prioridad !== ticket.prioridad
    || fechaRequerida !== fechaRequeridaInicial
    || proyectoId !== (ticket.proyecto_id ?? '')
    || nuevoProyecto.trim() !== ''
    || esGrupal !== ticket.es_grupal
    || miembros.length !== miembrosIniciales.length
    || miembros.some((id) => !miembrosIniciales.includes(id))
    || tiempoPropuestoHoras !== propuestoInicialHoras
    || tiempoPropuestoMinutos !== propuestoInicialMinutos
    || tiempoEjecutadoHoras !== ejecutadoInicialHoras
    || tiempoEjecutadoMinutos !== ejecutadoInicialMinutos
  )

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        className="modal-panel modal-panel--detalle"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-detalle-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="detalle__header">
          <nav className="detalle__ruta" aria-label="Ubicación de la tarea">
            <span className="detalle__numero">#{ticket.numero}</span>
            <span className="detalle__ruta-separador" aria-hidden="true">/</span>
            <span>{ticket.area?.nombre ?? 'Sin área'}</span>
            {ticket.proyecto && (
              <>
                <span className="detalle__ruta-separador" aria-hidden="true">/</span>
                <span>{ticket.proyecto.nombre}</span>
              </>
            )}
          </nav>
          <div className="detalle__header-acciones">
            {puedeEliminar && (
              <button
                type="button"
                className="detalle__boton-icono detalle__boton-icono--peligro"
                onClick={handleEliminar}
                disabled={eliminando}
                title="Eliminar tarea"
                aria-label="Eliminar tarea"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                </svg>
              </button>
            )}
            <button type="button" className="detalle__boton-icono" onClick={onClose} aria-label="Cerrar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </header>

        <div className="detalle__scroll">
          <form id="ticket-detalle-form" onSubmit={handleGuardar} className="detalle__cuerpo">
            <div className="detalle__principal">
              <div className="detalle__chips">
                <span className={`badge badge--estado-${ticket.estado}`}>{ESTADO_LABEL[ticket.estado]}</span>
                <span className={`badge badge--prioridad-${ticket.prioridad}`}>{PRIORIDAD_LABEL[ticket.prioridad]}</span>
                {ticket.es_grupal && <span className="badge badge--equipo">En grupo</span>}
              </div>

              {puedeEditarTiempos ? (
                <textarea
                  id="ticket-detalle-titulo"
                  className="detalle__titulo detalle__titulo--editable"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value.replace(/\n/g, ' '))}
                  rows={1}
                  aria-label="Título"
                  required
                />
              ) : (
                <h2 id="ticket-detalle-titulo" className="detalle__titulo">{ticket.titulo}</h2>
              )}

              <p className="detalle__autor">
                <Avatar nombre={solicitanteNombre} tamano="sm" />
                <span>
                  <strong>{solicitanteNombre}</strong> lo solicitó el {formatearFecha(ticket.created_at)}
                  {ticket.empresa_solicitante && <> · {ticket.empresa_solicitante}</>}
                </span>
              </p>

              {faltan.length > 0 && (
                <div className="detalle__alerta" role="status">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                  </svg>
                  <div>
                    <strong>Falta clasificar esta tarea</strong>
                    <p>
                      Está finalizada pero no tiene {faltan.join(' ni ')}.
                      {puedeEditarTiempos && ' Complétalo en el panel de detalles y guarda los cambios.'}
                    </p>
                  </div>
                </div>
              )}

              <section className="detalle__seccion">
                <h3 className="detalle__seccion-titulo">Descripción</h3>
                {puedeEditarTiempos ? (
                  <textarea
                    className="detalle__descripcion detalle__descripcion--editable"
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                    rows={5}
                    aria-label="Descripción"
                    required
                  />
                ) : (
                  <p className="detalle__descripcion">{ticket.descripcion}</p>
                )}
              </section>

              {ticket.archivo_url && (
                <section className="detalle__seccion">
                  <h3 className="detalle__seccion-titulo">Archivo adjunto</h3>
                  {esImagenAdjunta(ticket.archivo_url) ? (
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
                  )}
                </section>
              )}

              {ticket.estado === 'finalizado' && ticket.nota_finalizacion && (
                <section className="detalle__seccion">
                  <h3 className="detalle__seccion-titulo">Nota de finalización</h3>
                  <p className="detalle__nota">{ticket.nota_finalizacion}</p>
                </section>
              )}
            </div>

            <aside className="detalle__lateral" aria-label="Detalles de la tarea">
              <h3 className="detalle__seccion-titulo">Detalles</h3>
              <dl className="propiedades">
                <div className="propiedad">
                  <dt>Asignado a</dt>
                  <dd>
                    {asignados.length > 0 ? (
                      <span className="propiedad__personas">
                        {asignados.map((nombre) => (
                          <span key={nombre} className="propiedad__persona">
                            <Avatar nombre={nombre} tamano="sm" />
                            {nombre}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="propiedad__vacio">Bandeja general</span>
                    )}
                  </dd>
                </div>

                <div className="propiedad">
                  <dt><label htmlFor="detalle-prioridad">Prioridad</label></dt>
                  <dd>
                    {puedeEditarTiempos ? (
                      <select id="detalle-prioridad" value={prioridad} onChange={(e) => setPrioridad(e.target.value as Prioridad)}>
                        {Object.entries(PRIORIDAD_LABEL).map(([valor, etiqueta]) => (
                          <option key={valor} value={valor}>{etiqueta}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="propiedad__prioridad">
                        <span className={`propiedad__punto propiedad__punto--${ticket.prioridad}`} aria-hidden="true" />
                        {PRIORIDAD_LABEL[ticket.prioridad]}
                      </span>
                    )}
                  </dd>
                </div>

                <div className="propiedad">
                  <dt><label htmlFor="detalle-fecha">Para cuándo</label></dt>
                  <dd>
                    {puedeEditarTiempos ? (
                      <input id="detalle-fecha" type="datetime-local" value={fechaRequerida} onChange={(e) => setFechaRequerida(e.target.value)} />
                    ) : (
                      formatearFecha(ticket.fecha_requerida)
                    )}
                  </dd>
                </div>

                <div className="propiedad">
                  <dt>Área</dt>
                  <dd>{ticket.area?.nombre ?? <span className="propiedad__vacio">Sin definir</span>}</dd>
                </div>

                <div className="propiedad">
                  <dt><label htmlFor="detalle-proyecto">Proyecto</label></dt>
                  <dd>
                    {puedeEditarTiempos ? (
                      <>
                        <select
                          id="detalle-proyecto"
                          value={proyectoId}
                          onChange={(e) => setProyectoId(e.target.value)}
                          className={faltan.includes('proyecto') ? 'propiedad__control--falta' : undefined}
                          disabled={nuevoProyecto.trim() !== ''}
                        >
                          <option value="">Sin definir</option>
                          {proyectos.map((proyecto) => (
                            <option key={proyecto.id} value={proyecto.id}>{proyecto.nombre}</option>
                          ))}
                        </select>
                        {mostrarNuevoProyecto ? (
                          <input
                            value={nuevoProyecto}
                            onChange={(e) => setNuevoProyecto(e.target.value)}
                            placeholder="Nombre del proyecto nuevo"
                            aria-label="Nombre del proyecto nuevo"
                            autoFocus
                          />
                        ) : (
                          <button type="button" className="propiedad__enlace" onClick={() => setMostrarNuevoProyecto(true)}>
                            + Crear proyecto nuevo
                          </button>
                        )}
                      </>
                    ) : (
                      ticket.proyecto?.nombre ?? <span className="propiedad__vacio">Sin definir</span>
                    )}
                  </dd>
                </div>
              </dl>

              <h3 className="detalle__seccion-titulo">Tiempo</h3>
              <dl className="propiedades">
                <div className="propiedad">
                  <dt>Propuesto</dt>
                  <dd>
                    {puedeEditarTiempos ? (
                      <span className="tiempo-input">
                        <input type="number" min="0" step="1" value={tiempoPropuestoHoras} onChange={(e) => setTiempoPropuestoHoras(e.target.value)} placeholder="0" aria-label="Horas propuestas" />
                        <span>h</span>
                        <input type="number" min="0" max="59" step="1" value={tiempoPropuestoMinutos} onChange={(e) => setTiempoPropuestoMinutos(e.target.value)} placeholder="0" aria-label="Minutos propuestos" />
                        <span>min</span>
                      </span>
                    ) : (
                      formatearTiempo(ticket.tiempo_propuesto_horas)
                    )}
                  </dd>
                </div>
                <div className="propiedad">
                  <dt>Ejecutado</dt>
                  <dd>
                    {puedeEditarTiempos ? (
                      <span className={`tiempo-input${faltan.includes('tiempo ejecutado') ? ' propiedad__control--falta' : ''}`}>
                        <input type="number" min="0" step="1" value={tiempoEjecutadoHoras} onChange={(e) => setTiempoEjecutadoHoras(e.target.value)} placeholder="0" aria-label="Horas ejecutadas" />
                        <span>h</span>
                        <input type="number" min="0" max="59" step="1" value={tiempoEjecutadoMinutos} onChange={(e) => setTiempoEjecutadoMinutos(e.target.value)} placeholder="0" aria-label="Minutos ejecutados" />
                        <span>min</span>
                      </span>
                    ) : (
                      formatearTiempo(ticket.tiempo_ejecutado_horas)
                    )}
                  </dd>
                </div>
              </dl>
              {avance != null && (
                <div className="tiempo-avance">
                  <div className="tiempo-avance__barra" aria-hidden="true">
                    <span
                      className={`tiempo-avance__relleno${avance > 1 ? ' tiempo-avance__relleno--excedido' : ''}`}
                      style={{ width: `${Math.min(avance, 1) * 100}%` }}
                    />
                  </div>
                  <span className={avance > 1 ? 'tiempo-avance__texto--excedido' : undefined}>
                    {avance > 1
                      ? `Excedido en ${formatearTiempo(tiempoEjecutado! - tiempoPropuesto!)}`
                      : `${Math.round(avance * 100)} % del tiempo propuesto`}
                  </span>
                </div>
              )}

              {puedeEditarTiempos && (
                <>
                  <h3 className="detalle__seccion-titulo">Equipo</h3>
                  <label className="interruptor">
                    <input type="checkbox" checked={esGrupal} onChange={(e) => setEsGrupal(e.target.checked)} />
                    <span className="interruptor__pista" aria-hidden="true" />
                    Tarea en grupo
                  </label>
                  {esGrupal && (
                    <div className="modal-miembros__lista">
                      {agentes.map((agente) => (
                        <label
                          key={agente.id}
                          className={`modal-chip${miembros.includes(agente.id) ? ' modal-chip--activo' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={miembros.includes(agente.id)}
                            onChange={() => alternarMiembro(agente.id)}
                          />
                          {agente.full_name ?? agente.email}
                        </label>
                      ))}
                    </div>
                  )}
                </>
              )}
            </aside>
          </form>

          <section className="detalle__actividad" aria-label="Actividad">
            <div className="pestanas" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={pestana === 'comentarios'}
                className={`pestana${pestana === 'comentarios' ? ' pestana--activa' : ''}`}
                onClick={() => setPestana('comentarios')}
              >
                Comentarios
                {totalComentarios ? <span className="pestana__contador">{totalComentarios}</span> : null}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pestana === 'historial'}
                className={`pestana${pestana === 'historial' ? ' pestana--activa' : ''}`}
                onClick={() => setPestana('historial')}
              >
                Historial
              </button>
            </div>
            {pestana === 'comentarios'
              ? <ComentariosTicket ticketId={ticket.id} onComentado={onComentado} />
              : <HistorialCambios ticket={ticket} />}
          </section>
        </div>

        {puedeEditarTiempos && (
          <footer className="detalle__footer">
            {error ? (
              <p className="auth-error">{error}</p>
            ) : (
              <span className="detalle__estado-guardado">
                {hayCambios ? 'Tienes cambios sin guardar' : 'Sin cambios'}
              </span>
            )}
            <button type="submit" form="ticket-detalle-form" disabled={guardando || !hayCambios}>
              {guardando ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}
