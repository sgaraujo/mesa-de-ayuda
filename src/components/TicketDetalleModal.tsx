import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useArea } from '../context/AreaContext'
import { useConfirmar } from '../context/ConfirmacionContext'
import { useAreas } from '../hooks/useAreas'
import { useProyectos } from '../hooks/useProyectos'
import { useTiposSolicitud } from '../hooks/useTiposSolicitud'
import { useMiembrosArea } from '../hooks/useMiembrosArea'
import {
  clasificacionFaltante,
  esImagenAdjunta,
  esperaAprobacion,
  estaSinAsignar,
  fueRechazada,
  nombresAsignados,
  TICKET_SELECT,
} from '../lib/ticket'
import { notificarAsignacion, notificarNuevaTarea } from '../lib/notificaciones'
import { separarTiempo, combinarTiempo, formatearTiempo } from '../lib/tiempo'
import { ArchivosTicket } from './ArchivosTicket'
import { AdjuntosSolicitud } from './AdjuntosSolicitud'
import { ComentariosTicket } from './ComentariosTicket'
import { HistorialCambios } from './HistorialCambios'
import { RespuestaFinalizacion } from './RespuestaFinalizacion'
import { RechazarSolicitud } from './RechazarSolicitud'
import { Avatar } from './Avatar'
import { SemaforoVencimiento } from './SemaforoVencimiento'
import { SubtareasTicket } from './SubtareasTicket'
import { SelectorPersonas } from './SelectorPersona'
import type { ColumnaId } from './KanbanColumn'
import type { Prioridad, RelacionLaboralNelyoda, TicketConRelaciones } from '../types/database'

const PRIORIDAD_LABEL: Record<string, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
}

const PREFIJO_COPIA = 'Copy - '

// Los triggers de la base (fechas, datos de quien pidió, repetición) ya
// explican el motivo en español; se muestra tal cual en vez de un genérico.
function motivoErrorGuardar(error: { code?: string; message?: string } | null): string {
  if (!error?.message) return 'No se pudo guardar. Intenta de nuevo.'
  // Columna que el cliente envía pero la base no tiene: falta una migración.
  if (error.code === 'PGRST204' || error.code === '42703') {
    return `No se pudo guardar: a la base le falta una actualización (${error.message}). Avisa al administrador.`
  }
  if (error.code === '22023' || error.code === '42501') return error.message
  return `No se pudo guardar: ${error.message}`
}

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
  rechazado: 'Rechazada',
}

const COLUMNA_LABEL: Record<ColumnaId, string> = {
  tareas: 'Tareas (sin asignar)',
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

// Si Nelyoda no trae el área, se muestra la cuenta analítica o el proyecto.
function areaLaboral(relacion: RelacionLaboralNelyoda): string | null {
  return relacion.area ?? relacion.cuentaAnalitica ?? relacion.proyecto
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
  // Sin este callback no se ofrece duplicar (solo el tablero lo maneja).
  onDuplicado?: (ticket: TicketConRelaciones) => void
  // Mueve la tarea de columna igual que arrastrarla; sin él, el estado solo se muestra.
  onMover?: (destino: ColumnaId) => void
}

export function TicketDetalleModal({
  ticket,
  puedeEditarTiempos,
  puedeEliminar,
  onClose,
  onGuardado,
  onEliminado,
  onComentado,
  onDuplicado,
  onMover,
}: TicketDetalleModalProps) {
  const { profile } = useAuth()
  const confirmar = useConfirmar()
  // Superadmin o líder/agente de Desarrollo; las demás áreas solo ven el área.
  const { puedeCambiarArea } = useArea()
  const { areas } = useAreas()
  const areaId = ticket.area_id
  const { proyectos, recargar: recargarProyectos } = useProyectos(areaId)
  const { agentes } = useMiembrosArea(areaId)
  const { tipos } = useTiposSolicitud(areaId)

  const [titulo, setTitulo] = useState(ticket.titulo)
  const [descripcion, setDescripcion] = useState(ticket.descripcion)
  const [prioridad, setPrioridad] = useState<Prioridad>(ticket.prioridad)
  const fechaRequeridaInicial = aInputFecha(ticket.fecha_requerida)
  const [fechaRequerida, setFechaRequerida] = useState(fechaRequeridaInicial)
  const fechaCompromisoInicial = aInputFecha(ticket.fecha_compromiso)
  const [fechaCompromiso, setFechaCompromiso] = useState(fechaCompromisoInicial)
  const [proyectoId, setProyectoId] = useState(ticket.proyecto_id ?? '')
  const [tipoId, setTipoId] = useState(ticket.tipo_id ?? '')
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
  // Repetición mensual (migración 0044). Sin la migración las columnas no
  // vienen y la sección no se muestra ni se envía.
  const soportaRecurrencia = ticket.recurrencia_activa !== undefined
  const recurrenciaDiaInicial = ticket.recurrencia_dia != null ? String(ticket.recurrencia_dia) : ''
  const recurrenciaPlazoInicial = ticket.recurrencia_plazo_dias != null ? String(ticket.recurrencia_plazo_dias) : ''
  const [recurrenciaActiva, setRecurrenciaActiva] = useState(!!ticket.recurrencia_activa)
  const [recurrenciaDia, setRecurrenciaDia] = useState(recurrenciaDiaInicial)
  const [recurrenciaPlazo, setRecurrenciaPlazo] = useState(recurrenciaPlazoInicial)
  // Solo en la original (una copia no se repite) y desde el tablero.
  const puedeConfigurarRecurrencia = puedeEditarTiempos && soportaRecurrencia
    && !ticket.recurrencia_origen && ticket.estado !== 'rechazado'
  const recurrenciaCambio = puedeConfigurarRecurrencia && (
    recurrenciaActiva !== !!ticket.recurrencia_activa
    || (recurrenciaActiva && (recurrenciaDia !== recurrenciaDiaInicial || recurrenciaPlazo !== recurrenciaPlazoInicial))
  )
  const [guardando, setGuardando] = useState(false)
  const [eliminando, setEliminando] = useState(false)
  const [duplicando, setDuplicando] = useState(false)
  const [cambiandoArea, setCambiandoArea] = useState(false)
  // Número de la tarea de la que se duplicó esta. Se consulta aparte y no
  // dentro de TICKET_SELECT: si esa consulta falla, el tablero no se queda vacío.
  // Queda en null si quien mira no puede ver el original.
  const [numeroOrigen, setNumeroOrigen] = useState<number | null>(null)

  useEffect(() => {
    if (!ticket.duplicado_de) return
    let vigente = true
    void supabase
      .from('tickets')
      .select('numero')
      .eq('id', ticket.duplicado_de)
      .maybeSingle()
      .then(({ data }) => {
        if (vigente) setNumeroOrigen(data?.numero ?? null)
      })
    return () => {
      vigente = false
    }
  }, [ticket.duplicado_de])

  // Igual, para las copias de una tarea que se repite cada mes.
  const [numeroRecurrenciaOrigen, setNumeroRecurrenciaOrigen] = useState<number | null>(null)

  useEffect(() => {
    if (!ticket.recurrencia_origen) return
    let vigente = true
    void supabase
      .from('tickets')
      .select('numero')
      .eq('id', ticket.recurrencia_origen)
      .maybeSingle()
      .then(({ data }) => {
        if (vigente) setNumeroRecurrenciaOrigen(data?.numero ?? null)
      })
    return () => {
      vigente = false
    }
  }, [ticket.recurrencia_origen])

  // Cargo y área del solicitante según Nelyoda (migración 0034). Aparte por la
  // misma razón: si no hay datos o la consulta falla, solo no se muestran.
  const [relacionSolicitante, setRelacionSolicitante] = useState<RelacionLaboralNelyoda | null>(null)
  const correoSolicitante = ticket.solicitante?.email

  useEffect(() => {
    if (!correoSolicitante) return
    let vigente = true
    void supabase
      .from('personas_nelyoda')
      .select('relaciones')
      .eq('email', correoSolicitante)
      .maybeSingle()
      .then(({ data }) => {
        const relaciones = (data?.relaciones ?? []) as RelacionLaboralNelyoda[]
        if (vigente) setRelacionSolicitante(relaciones[0] ?? null)
      })
    return () => {
      vigente = false
    }
  }, [correoSolicitante])
  const [error, setError] = useState<string | null>(null)
  const [pestana, setPestana] = useState<'comentarios' | 'archivos' | 'historial'>('comentarios')
  const [rechazando, setRechazando] = useState(false)

  async function handleGuardar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!titulo.trim() || !descripcion.trim()) {
      setError('El título y la descripción no pueden quedar vacíos.')
      return
    }
    // Lo valida también la base (migración 0041); aquí se avisa antes.
    if (fechaCompromiso !== fechaCompromisoInicial && fechaCompromiso && new Date(fechaCompromiso).getTime() <= Date.now()) {
      setError('La fecha compromiso debe ser posterior a este momento.')
      return
    }
    const plazoRecurrencia = recurrenciaPlazo.trim() === '' ? null : Number(recurrenciaPlazo)
    if (recurrenciaCambio && recurrenciaActiva) {
      if (!recurrenciaDia) {
        setError('Elige el día del mes en que se repite la tarea.')
        return
      }
      if (plazoRecurrencia !== null && (!Number.isInteger(plazoRecurrencia) || plazoRecurrencia < 0 || plazoRecurrencia > 90)) {
        setError('El plazo de las copias debe ser un número de días entre 0 y 90.')
        return
      }
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
        fecha_compromiso: fechaCompromiso === fechaCompromisoInicial
          ? ticket.fecha_compromiso
          : fechaCompromiso ? new Date(fechaCompromiso).toISOString() : null,
        proyecto_id: proyectoIdFinal,
        tipo_id: tipoId || null,
        es_grupal: esGrupal,
        asignado_a: esGrupal ? null : ticket.asignado_a,
        // Con subtareas los tiempos los calcula la base (0042); no se envían.
        ...(conSubtareas ? {} : {
          tiempo_propuesto_horas: combinarTiempo(tiempoPropuestoHoras, tiempoPropuestoMinutos),
          tiempo_ejecutado_horas: combinarTiempo(tiempoEjecutadoHoras, tiempoEjecutadoMinutos),
        }),
        // Solo si cambió: sin la migración 0044 estas columnas no existen.
        ...(recurrenciaCambio ? {
          recurrencia_activa: recurrenciaActiva,
          recurrencia_dia: recurrenciaActiva ? Number(recurrenciaDia) : ticket.recurrencia_dia ?? null,
          recurrencia_plazo_dias: recurrenciaActiva ? plazoRecurrencia : ticket.recurrencia_plazo_dias ?? null,
        } : {}),
      })
      .eq('id', ticket.id)
      .select()
      .single()

    if (error || !data) {
      setGuardando(false)
      console.error('No se pudo guardar la tarea:', error)
      setError(motivoErrorGuardar(error))
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
      tipo: tipos.find((t) => t.id === data.tipo_id) ?? (data.tipo_id === ticket.tipo_id ? ticket.tipo : null),
      asignados: asignadosActualizados,
    })
  }

  async function handleEliminar() {
    if (!(await confirmar({
      titulo: `¿Eliminar la tarea #${ticket.numero}?`,
      descripcion: 'Se eliminará de forma permanente. Esta acción no se puede deshacer.',
      textoConfirmar: 'Eliminar',
    }))) return
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

  // Copia la tarea guardada (no los cambios sin guardar del formulario) para
  // procesos recurrentes. Conserva contenido, adjunto, proyecto, prioridad,
  // tiempo propuesto y responsables; arranca en curso, sin tiempo ejecutado,
  // sin fecha requerida (la del original suele haber pasado) y sin
  // comentarios. Si el original no tenía responsable, queda a cargo de quien
  // duplica.
  async function handleDuplicar() {
    if (!profile) return
    if (!(await confirmar({
      titulo: `¿Duplicar la tarea #${ticket.numero}?`,
      descripcion: 'Se creará una tarea nueva en curso con el mismo contenido, sin los comentarios.',
      textoConfirmar: 'Duplicar',
      tono: 'normal',
    }))) return
    setError(null)
    setDuplicando(true)

    const asignadoA = ticket.es_grupal ? null : ticket.asignado_a ?? profile.id
    const { data: creado, error: errorCrear } = await supabase
      .from('tickets')
      .insert({
        // El prefijo distingue la copia del original a simple vista. Una copia
        // de otra copia no lo repite ("Copy - Copy - ...").
        titulo: ticket.titulo.startsWith(PREFIJO_COPIA) ? ticket.titulo : `${PREFIJO_COPIA}${ticket.titulo}`,
        descripcion: ticket.descripcion,
        solicitante_id: profile.id,
        empresa_solicitante: profile.empresa,
        area_id: ticket.area_id,
        proyecto_id: ticket.proyecto_id,
        tipo_id: ticket.tipo_id,
        prioridad: ticket.prioridad,
        es_grupal: ticket.es_grupal,
        asignado_a: asignadoA,
        estado: 'en_curso',
        tiempo_propuesto_horas: ticket.tiempo_propuesto_horas,
        archivo_url: ticket.archivo_url,
        duplicado_de: ticket.id,
      })
      .select('id')
      .single()

    if (errorCrear || !creado) {
      setDuplicando(false)
      setError('No se pudo duplicar la tarea. Intenta de nuevo.')
      return
    }

    const miembrosOriginales = ticket.asignados.map((a) => a.profile.id)
    if (ticket.es_grupal && miembrosOriginales.length > 0) {
      await supabase
        .from('ticket_asignados')
        .insert(miembrosOriginales.map((profile_id) => ({ ticket_id: creado.id, profile_id })))
    }
    await supabase.from('ticket_status_history').insert({
      ticket_id: creado.id,
      estado: 'en_curso',
      changed_by: profile.id,
    })
    void notificarAsignacion(creado.id, asignadoA ? [asignadoA] : miembrosOriginales)

    const { data: copia } = await supabase.from('tickets').select(TICKET_SELECT).eq('id', creado.id).single()
    setDuplicando(false)
    if (!copia) {
      setError('La tarea se duplicó, pero no se pudo abrir. Recarga el tablero para verla.')
      return
    }
    onDuplicado?.(copia as unknown as TicketConRelaciones)
  }

  // Corrige una tarea enviada al área equivocada (superadmin o Desarrollo). Llega a la
  // bandeja del área nueva: sin proyecto, sin responsables y en pendiente.
  async function handleCambiarArea(nuevaAreaId: string) {
    const destino = areas.find((area) => area.id === nuevaAreaId)
    if (!destino || nuevaAreaId === ticket.area_id) return
    if (!(await confirmar({
      titulo: `¿Enviar la tarea #${ticket.numero} al área ${destino.nombre}?`,
      descripcion: 'Quedará sin asignar en la bandeja de esa área, en Pendiente y sin proyecto. '
        + 'Se conservan comentarios, archivos e historial.',
      textoConfirmar: 'Enviar',
      tono: 'normal',
    }))) return
    setError(null)
    setCambiandoArea(true)

    const { error: errorArea } = await supabase.rpc('cambiar_area_ticket', {
      p_ticket_id: ticket.id,
      p_area_id: nuevaAreaId,
    })
    if (errorArea) {
      console.error('No se pudo cambiar el área:', errorArea.message)
      setCambiandoArea(false)
      setError('No se pudo cambiar el área. Intenta de nuevo.')
      return
    }

    void notificarNuevaTarea(ticket.id)
    const { data: actualizado } = await supabase.from('tickets').select(TICKET_SELECT).eq('id', ticket.id).single()
    setCambiandoArea(false)
    onGuardado(actualizado
      ? (actualizado as unknown as TicketConRelaciones)
      : { ...ticket, area_id: destino.id, area: { id: destino.id, nombre: destino.nombre } })
  }

  const solicitanteNombre = ticket.solicitante?.full_name ?? ticket.solicitante?.email ?? 'Alguien'
  // La fecha y el tipo que puso quien pidió la tarea solo los cambia esa
  // persona (migración 0036); si los dejó vacíos, el equipo puede definirlos.
  const esSolicitante = profile?.id === ticket.solicitante_id
  const fechaBloqueada = !!ticket.fecha_requerida && !esSolicitante
  const tipoBloqueado = !!ticket.tipo_id && !esSolicitante
  const asignados = nombresAsignados(ticket)
  const faltan = clasificacionFaltante(ticket)
  const totalComentarios = ticket.comentarios?.[0]?.count
  const rechazada = ticket.estado === 'rechazado'
  const columnaActual: ColumnaId | null = ticket.estado === 'rechazado' ? null : estaSinAsignar(ticket) ? 'tareas' : ticket.estado
  // Solo desde el tablero (onMover) y mientras no esté cerrada.
  const puedeRechazar = puedeEditarTiempos && !!onMover && !rechazada && ticket.estado !== 'finalizado'

  // Con subtareas los tiempos son su suma (migración 0042): no se editan aquí.
  const conSubtareas = (ticket.subtareas_total ?? 0) > 0
  const tiempoPropuesto = conSubtareas ? ticket.tiempo_propuesto_horas : combinarTiempo(tiempoPropuestoHoras, tiempoPropuestoMinutos)
  const tiempoEjecutado = conSubtareas ? ticket.tiempo_ejecutado_horas : combinarTiempo(tiempoEjecutadoHoras, tiempoEjecutadoMinutos)
  const avance = tiempoPropuesto && tiempoEjecutado != null ? tiempoEjecutado / tiempoPropuesto : null

  const miembrosIniciales = ticket.asignados.map((a) => a.profile.id)
  const hayCambios = puedeEditarTiempos && (
    titulo !== ticket.titulo
    || descripcion !== ticket.descripcion
    || prioridad !== ticket.prioridad
    || fechaRequerida !== fechaRequeridaInicial
    || fechaCompromiso !== fechaCompromisoInicial
    || recurrenciaCambio
    || proyectoId !== (ticket.proyecto_id ?? '')
    || tipoId !== (ticket.tipo_id ?? '')
    || nuevoProyecto.trim() !== ''
    || esGrupal !== ticket.es_grupal
    || miembros.length !== miembrosIniciales.length
    || miembros.some((id) => !miembrosIniciales.includes(id))
    || (!conSubtareas && (
      tiempoPropuestoHoras !== propuestoInicialHoras
      || tiempoPropuestoMinutos !== propuestoInicialMinutos
      || tiempoEjecutadoHoras !== ejecutadoInicialHoras
      || tiempoEjecutadoMinutos !== ejecutadoInicialMinutos
    ))
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
            {puedeEditarTiempos && onDuplicado && (
              <button
                type="button"
                className="detalle__boton-icono"
                onClick={handleDuplicar}
                disabled={duplicando || hayCambios}
                title={hayCambios ? 'Guarda los cambios antes de duplicar' : 'Duplicar tarea'}
                aria-label="Duplicar tarea"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="12" height="12" rx="2" />
                  <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
                </svg>
              </button>
            )}
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
                {esperaAprobacion(ticket) && <span className="badge badge--por-aprobar">Por aprobar</span>}
                {ticket.estado === 'finalizado' && ticket.aprobacion === 'aprobada' && (
                  <span className="badge badge--aprobada">Aprobada</span>
                )}
                {fueRechazada(ticket) && <span className="badge badge--rechazada">Rechazada por el solicitante</span>}
                <SemaforoVencimiento ticket={ticket} />
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
                  {numeroOrigen != null && <> · Duplicada de #{numeroOrigen}</>}
                  {ticket.recurrencia_origen && (
                    <> · Generada automáticamente{numeroRecurrenciaOrigen != null && <> de #{numeroRecurrenciaOrigen}</>} (repetición mensual)</>
                  )}
                  {relacionSolicitante && (relacionSolicitante.cargo || areaLaboral(relacionSolicitante)) && (
                    <span className="detalle__autor-cargo">
                      {[relacionSolicitante.cargo, areaLaboral(relacionSolicitante)].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
              </p>

              {/* Importada de una reunión de Teams (migración 0045). */}
              {ticket.reunion_url && (
                <a href={ticket.reunion_url} target="_blank" rel="noreferrer" className="boton-secundario detalle__reunion">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 10l5-3v10l-5-3M4 7h11v10H4z" />
                  </svg>
                  {ticket.estado === 'finalizado' ? 'Abrir la reunión en Teams' : 'Unirse a la reunión en Teams'}
                </a>
              )}

              {esperaAprobacion(ticket) && profile?.id === ticket.solicitante_id && (
                <RespuestaFinalizacion ticket={ticket} onRespondido={onGuardado} />
              )}

              {rechazando && puedeRechazar && (
                <RechazarSolicitud ticket={ticket} onRechazado={onGuardado} onCancelar={() => setRechazando(false)} />
              )}

              {rechazada && ticket.motivo_rechazo && (
                <section className="detalle__seccion">
                  <h3 className="detalle__seccion-titulo">Motivo del rechazo</h3>
                  <p className="detalle__motivo-rechazo">{ticket.motivo_rechazo}</p>
                </section>
              )}

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

              {/* Solicitudes de antes de la migración 0040: un solo adjunto en archivo_url. */}
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

              <AdjuntosSolicitud ticketId={ticket.id} />

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
                {puedeEditarTiempos && onMover && columnaActual && (
                  <div className="propiedad">
                    <dt><label htmlFor="detalle-estado">Estado</label></dt>
                    <dd>
                      {/* Se aplica al instante, como al arrastrar; no espera a "Guardar cambios". */}
                      <select
                        id="detalle-estado"
                        value={columnaActual}
                        onChange={(e) => onMover(e.target.value as ColumnaId)}
                      >
                        {(Object.keys(COLUMNA_LABEL) as ColumnaId[])
                          // Las tareas en grupo no vuelven a la bandeja: sus
                          // personas se quitan desde la sección Equipo.
                          .filter((columna) => columna !== 'tareas' || !ticket.es_grupal)
                          .map((columna) => (
                            <option key={columna} value={columna}>{COLUMNA_LABEL[columna]}</option>
                          ))}
                      </select>
                      {puedeRechazar && !rechazando && (
                        <button
                          type="button"
                          className="propiedad__enlace propiedad__enlace--peligro"
                          onClick={() => setRechazando(true)}
                          disabled={hayCambios}
                          title={hayCambios ? 'Guarda los cambios antes de rechazar' : 'La solicitud no se va a atender'}
                        >
                          Rechazar solicitud
                        </button>
                      )}
                    </dd>
                  </div>
                )}

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
                  <dd title={fechaBloqueada && puedeEditarTiempos ? 'La definió quien hizo la solicitud' : undefined}>
                    {puedeEditarTiempos && !fechaBloqueada ? (
                      <input id="detalle-fecha" type="datetime-local" value={fechaRequerida} onChange={(e) => setFechaRequerida(e.target.value)} />
                    ) : (
                      formatearFecha(ticket.fecha_requerida)
                    )}
                  </dd>
                </div>

                {/* La define el equipo; el vencimiento se mide contra ella o,
                    si está vacía, contra "Para cuándo" (migración 0041). */}
                <div className="propiedad">
                  <dt><label htmlFor="detalle-compromiso">Compromiso</label></dt>
                  <dd title="Fecha y hora a la que el equipo se compromete a terminarla">
                    {puedeEditarTiempos ? (
                      <input
                        id="detalle-compromiso"
                        type="datetime-local"
                        value={fechaCompromiso}
                        min={aInputFecha(new Date().toISOString())}
                        onChange={(e) => setFechaCompromiso(e.target.value)}
                      />
                    ) : ticket.fecha_compromiso ? (
                      formatearFecha(ticket.fecha_compromiso)
                    ) : (
                      <span className="propiedad__vacio">Sin definir</span>
                    )}
                  </dd>
                </div>

                <div className="propiedad">
                  <dt>{puedeCambiarArea ? <label htmlFor="detalle-area">Área</label> : 'Área'}</dt>
                  <dd>
                    {puedeCambiarArea ? (
                      // Se aplica al instante (con confirmación), como el estado.
                      <select
                        id="detalle-area"
                        value={ticket.area_id}
                        onChange={(e) => void handleCambiarArea(e.target.value)}
                        disabled={cambiandoArea || hayCambios}
                        title={hayCambios ? 'Guarda los cambios antes de cambiar el área' : 'Enviar la tarea a otra área'}
                      >
                        {areas.length === 0 && ticket.area && <option value={ticket.area.id}>{ticket.area.nombre}</option>}
                        {areas.map((area) => (
                          <option key={area.id} value={area.id}>{area.nombre}</option>
                        ))}
                      </select>
                    ) : (
                      ticket.area?.nombre ?? <span className="propiedad__vacio">Sin definir</span>
                    )}
                  </dd>
                </div>

                {(tipos.length > 0 || ticket.tipo) && (
                  <div className="propiedad">
                    <dt><label htmlFor="detalle-tipo">Tipo</label></dt>
                    <dd title={tipoBloqueado && puedeEditarTiempos ? 'Lo definió quien hizo la solicitud' : undefined}>
                      {puedeEditarTiempos && !tipoBloqueado && tipos.length > 0 ? (
                        <select id="detalle-tipo" value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
                          <option value="">Sin definir</option>
                          {/* Un tipo ya desactivado sigue visible en las tareas que lo usan. */}
                          {ticket.tipo && !tipos.some((t) => t.id === ticket.tipo!.id) && (
                            <option value={ticket.tipo.id}>{ticket.tipo.nombre}</option>
                          )}
                          {tipos.map((tipo) => (
                            <option key={tipo.id} value={tipo.id}>{tipo.nombre}</option>
                          ))}
                        </select>
                      ) : (
                        ticket.tipo?.nombre ?? <span className="propiedad__vacio">Sin definir</span>
                      )}
                    </dd>
                  </div>
                )}

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

              {puedeConfigurarRecurrencia ? (
                <>
                  <h3 className="detalle__seccion-titulo">Repetición</h3>
                  <label className="interruptor">
                    <input type="checkbox" checked={recurrenciaActiva} onChange={(e) => setRecurrenciaActiva(e.target.checked)} />
                    <span className="interruptor__pista" aria-hidden="true" />
                    Repetir cada mes
                  </label>
                  {recurrenciaActiva && (
                    <dl className="propiedades recurrencia">
                      <div className="propiedad">
                        <dt><label htmlFor="detalle-recurrencia-dia">Día del mes</label></dt>
                        <dd>
                          <select id="detalle-recurrencia-dia" value={recurrenciaDia} onChange={(e) => setRecurrenciaDia(e.target.value)}>
                            <option value="" disabled>Elige</option>
                            {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((dia) => (
                              <option key={dia} value={dia}>{dia}</option>
                            ))}
                          </select>
                        </dd>
                      </div>
                      <div className="propiedad">
                        <dt><label htmlFor="detalle-recurrencia-plazo">Plazo</label></dt>
                        <dd title="Días que tiene cada copia para terminarse; define su fecha compromiso. Vacío = sin plazo.">
                          <span className="tiempo-input">
                            <input
                              id="detalle-recurrencia-plazo"
                              type="number"
                              min="0"
                              max="90"
                              step="1"
                              value={recurrenciaPlazo}
                              onChange={(e) => setRecurrenciaPlazo(e.target.value)}
                              placeholder="—"
                            />
                            <span>días</span>
                          </span>
                        </dd>
                      </div>
                    </dl>
                  )}
                  <p className="recurrencia__nota">
                    {recurrenciaActiva && ticket.recurrencia_activa && ticket.recurrencia_proxima && !recurrenciaCambio
                      ? <>Próxima copia: <strong>{formatearFecha(ticket.recurrencia_proxima)}</strong></>
                      : recurrenciaActiva
                        ? 'Guarda los cambios para programar la próxima copia.'
                        : 'Crea una copia de esta tarea cada mes, con sus responsables y subtareas.'}
                  </p>
                </>
              ) : ticket.recurrencia_activa && ticket.recurrencia_dia ? (
                <>
                  <h3 className="detalle__seccion-titulo">Repetición</h3>
                  <p className="recurrencia__nota">
                    Se repite cada mes, el día {ticket.recurrencia_dia}
                    {ticket.recurrencia_proxima && <> · próxima: {formatearFecha(ticket.recurrencia_proxima)}</>}
                  </p>
                </>
              ) : null}

              <h3 className="detalle__seccion-titulo">Tiempo</h3>
              {conSubtareas && <p className="detalle__nota-tiempo">Suma de las subtareas</p>}
              <dl className="propiedades">
                <div className="propiedad">
                  <dt>Propuesto</dt>
                  <dd>
                    {puedeEditarTiempos && !conSubtareas ? (
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
                    {puedeEditarTiempos && !conSubtareas ? (
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
                      <SelectorPersonas
                        personas={agentes}
                        valores={miembros}
                        onCambiar={setMiembros}
                        placeholder="Escribe un nombre para agregar…"
                        aria-label="Personas del grupo"
                      />
                    </div>
                  )}
                </>
              )}
            </aside>
          </form>

          {/* Fuera del formulario del detalle: tiene su propio formulario y
              cada cambio se guarda al instante (no espera "Guardar cambios"). */}
          <div className="detalle__subtareas">
            <SubtareasTicket
              ticketId={ticket.id}
              areaId={ticket.area_id}
              puedeGestionar={puedeEditarTiempos && ticket.estado !== 'rechazado'}
              // Refresca la tarjeta (tiempos y avance) igual que un comentario nuevo.
              onCambio={onComentado}
            />
          </div>

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
                aria-selected={pestana === 'archivos'}
                className={`pestana${pestana === 'archivos' ? ' pestana--activa' : ''}`}
                onClick={() => setPestana('archivos')}
              >
                Archivos
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
            {pestana === 'comentarios' && <ComentariosTicket ticketId={ticket.id} onComentado={onComentado} />}
            {pestana === 'archivos' && <ArchivosTicket ticket={ticket} />}
            {pestana === 'historial' && <HistorialCambios ticket={ticket} />}
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
