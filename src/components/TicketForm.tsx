import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useArea } from '../context/AreaContext'
import { useAreas } from '../hooks/useAreas'
import { useTiposSolicitud } from '../hooks/useTiposSolicitud'
import { useMiembrosArea } from '../hooks/useMiembrosArea'
import { SugerenciasTexto } from './SugerenciasTexto'
import { AsistenteSolicitud } from './AsistenteSolicitud'
import { SelectorPersona, type PersonaOpcion } from './SelectorPersona'
import type { Prioridad } from '../types/database'
import { notificarAsignacion, notificarNuevaTarea } from '../lib/notificaciones'
import {
  ARCHIVO_SOLICITUD_EXTENSIONES as EXTENSIONES_PERMITIDAS,
  ARCHIVO_SOLICITUD_MAX_MB as ARCHIVO_MAX_MB,
  ARCHIVOS_POR_SOLICITUD,
  esImagen,
  extensionDe,
  pesoLegible,
  subirArchivoSolicitud,
} from '../lib/archivos'
import { IconoArchivo } from './ArchivoAdjunto'

const PRIORIDADES: { valor: Prioridad; etiqueta: string; ayuda: string }[] = [
  { valor: 'baja', etiqueta: 'Baja', ayuda: 'Cuando haya tiempo' },
  { valor: 'media', etiqueta: 'Media', ayuda: 'En los próximos días' },
  { valor: 'alta', etiqueta: 'Alta', ayuda: 'Lo antes posible' },
  { valor: 'urgente', etiqueta: 'Urgente', ayuda: 'Bloquea el trabajo' },
]

function hoyLocal(): string {
  const hoy = new Date()
  return new Date(hoy.getTime() - hoy.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

// "AAAA-MM-DDTHH:mm" en hora local, para el min de <input type="datetime-local">.
function ahoraLocal(): string {
  const ahora = new Date()
  return new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

// La fecha elegida cuenta hasta el final de ese día (hora local): la tarea
// solo aparece vencida cuando el día ya pasó.
function fechaRequeridaIso(fecha: string): string | null {
  return fecha ? new Date(`${fecha}T23:59:00`).toISOString() : null
}

function iniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/)
  return (palabras.length > 1 ? palabras[0][0] + palabras[1][0] : nombre.slice(0, 2)).toUpperCase()
}

// Cada área toma un color fijo de la paleta según su posición (orden).
function estiloArea(indice: number): CSSProperties {
  return { '--area-color': `var(--series-${(indice % 8) + 1})` } as CSSProperties
}

interface TicketFormProps {
  asignadoAPorDefecto?: string
  // true: formulario por pasos para elegir a qué área enviar la solicitud.
  // false: formulario compacto del tablero ("Nueva tarea"): siempre en el
  // área activa, sin cambiarla (para otra área está Nueva solicitud); el
  // líder puede asignarla a alguien de su equipo.
  elegirArea?: boolean
  onCreado?: () => void
  onDirtyChange?: (dirty: boolean) => void
  // Solo el formulario del tablero: botón Cancelar del pie del modal.
  onCancelar?: () => void
}

export function TicketForm({ asignadoAPorDefecto = '', elegirArea = false, onCreado, onDirtyChange, onCancelar }: TicketFormProps) {
  const { profile } = useAuth()
  const { areaActiva, areas: misAreas } = useArea()
  const { areas: todasLasAreas, loading: cargandoAreas } = useAreas()
  // En el formulario por pasos no hay área preseleccionada: quien envía la
  // solicitud debe elegir el destino a conciencia. Desde el tablero es siempre el área activa.
  const [areaDestinoId, setAreaDestinoId] = useState('')
  const areaId = elegirArea ? areaDestinoId : areaActiva?.id ?? ''
  const rolEnDestino = misAreas.find((a) => a.id === areaId)?.rol
  // Solo el formulario del tablero ofrece asignar; el líder elige a quién.
  const { agentes: equipo } = useMiembrosArea(elegirArea ? undefined : areaId)
  const [asignadoA, setAsignadoA] = useState(asignadoAPorDefecto)
  // Nueva solicitud: quien la envía puede dirigirla (opcional) a una persona
  // del área destino. No es miembro, así que la lista sale de una RPC
  // (migración 0047).
  const [personasDestino, setPersonasDestino] = useState<PersonaOpcion[]>([])
  useEffect(() => {
    if (!elegirArea) return
    setAsignadoA('')
    setPersonasDestino([])
    if (!areaDestinoId) return
    let cancelado = false
    void supabase.rpc('miembros_area_solicitud', { p_area_id: areaDestinoId }).then(({ data }) => {
      if (cancelado) return
      const filas = (data ?? []) as { id: string; full_name: string | null; email: string; rol: string }[]
      setPersonasDestino(filas.map((f) => ({
        id: f.id,
        full_name: f.full_name,
        email: f.email,
        area_id: areaDestinoId,
        detalle: f.rol === 'lider' ? 'Líder' : 'Agente',
      })))
    })
    return () => {
      cancelado = true
    }
  }, [elegirArea, areaDestinoId])
  const { tipos } = useTiposSolicitud(areaId)
  const [tipoId, setTipoId] = useState('')
  // El tipo es del área: si cambia el destino, se vuelve a elegir.
  useEffect(() => setTipoId(''), [areaId])

  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [prioridad, setPrioridad] = useState<Prioridad>('media')
  // "AAAA-MM-DD" del <input type="date">; vacío = sin fecha.
  const [fechaRequerida, setFechaRequerida] = useState('')
  // "AAAA-MM-DDTHH:mm" del <input type="datetime-local">; solo la pone el
  // equipo del área desde el tablero (migración 0041).
  const [fechaCompromiso, setFechaCompromiso] = useState('')
  const [archivos, setArchivos] = useState<File[]>([])
  const [arrastrandoArchivo, setArrastrandoArchivo] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState(false)
  const archivoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    onDirtyChange?.(
      titulo.trim() !== '' || descripcion.trim() !== '' || archivos.length > 0 || fechaRequerida !== '' || fechaCompromiso !== '',
    )
  }, [titulo, descripcion, archivos, fechaRequerida, fechaCompromiso, onDirtyChange])

  // Agrega los válidos a la lista; los que no sirven se explican en el error.
  function agregarArchivos(lista: FileList | null) {
    // Se copian antes de vaciar el input: su FileList queda vacía al limpiarlo.
    // Se limpia para poder volver a elegir el mismo archivo después de quitarlo.
    const elegidos = lista ? Array.from(lista) : []
    if (archivoInputRef.current) archivoInputRef.current.value = ''
    if (elegidos.length === 0) return
    const problemas: string[] = []
    const nuevos: File[] = []
    for (const file of elegidos) {
      if (!EXTENSIONES_PERMITIDAS.includes(extensionDe(file.name))) {
        problemas.push(`"${file.name}" no es un formato permitido.`)
      } else if (file.size === 0) {
        problemas.push(`"${file.name}" está vacío.`)
      } else if (file.size > ARCHIVO_MAX_MB * 1024 * 1024) {
        problemas.push(`"${file.name}" pesa más de ${ARCHIVO_MAX_MB} MB.`)
      } else if (!archivos.some((a) => a.name === file.name && a.size === file.size)) {
        nuevos.push(file)
      }
    }
    const cupo = ARCHIVOS_POR_SOLICITUD - archivos.length
    if (nuevos.length > cupo) problemas.push(`Puedes adjuntar hasta ${ARCHIVOS_POR_SOLICITUD} archivos.`)
    setArchivos([...archivos, ...nuevos.slice(0, Math.max(cupo, 0))])
    setError(problemas.length > 0 ? problemas.join(' ') : null)
  }

  function handleArchivoChange(e: ChangeEvent<HTMLInputElement>) {
    agregarArchivos(e.target.files)
  }

  function handleArchivoDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setArrastrandoArchivo(false)
    agregarArchivos(e.dataTransfer.files)
  }

  function quitarArchivo(indice: number) {
    setArchivos((prev) => prev.filter((_, i) => i !== indice))
    setError(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile || !areaId) return
    if (tipos.length > 0 && !tipoId) {
      setError('Elige el tipo de solicitud.')
      return
    }
    const puedeAutoasignarse = rolEnDestino === 'agente' || rolEnDestino === 'lider'
    const compromisoFinal = puedeAutoasignarse && fechaCompromiso ? new Date(fechaCompromiso) : null
    // Lo valida también la base (migración 0041); aquí se avisa antes.
    if (compromisoFinal && compromisoFinal.getTime() <= Date.now()) {
      setError('La fecha compromiso debe ser posterior a este momento.')
      return
    }
    setError(null)
    setEnviando(true)

    const asignadoFinal = puedeAutoasignarse || elegirArea ? asignadoA || null : null
    const { data: ticketCreado, error } = await supabase
      .from('tickets')
      .insert({
        titulo,
        descripcion,
        solicitante_id: profile.id,
        empresa_solicitante: profile.empresa,
        area_id: areaId,
        tipo_id: tipos.length > 0 ? tipoId || null : null,
        asignado_a: asignadoFinal,
        prioridad,
        fecha_requerida: fechaRequeridaIso(fechaRequerida),
        fecha_compromiso: compromisoFinal?.toISOString() ?? null,
        estado: 'pendiente',
      })
      .select('id')
      .single()

    if (error || !ticketCreado) {
      setEnviando(false)
      setError('No se pudo crear la solicitud. Intenta de nuevo.')
      return
    }

    // Los archivos van en la carpeta de la tarea, que ya existe, y se
    // registran juntos en ticket_archivos (migración 0040).
    let errorArchivos: string | null = null
    if (archivos.length > 0) {
      try {
        const subidos = await Promise.all(archivos.map((file) => subirArchivoSolicitud(ticketCreado.id, file)))
        const { error: errorRegistro } = await supabase.rpc('adjuntar_archivos_solicitud', {
          p_ticket_id: ticketCreado.id,
          p_archivos: subidos,
        })
        if (errorRegistro) throw errorRegistro
      } catch (errorSubida) {
        console.error('No se pudieron adjuntar los archivos:', (errorSubida as Error).message)
        errorArchivos = 'La solicitud se creó, pero no se pudieron adjuntar los archivos. Agrégalos desde un comentario de la solicitud.'
      }
    }
    setEnviando(false)

    if (asignadoFinal) void notificarAsignacion(ticketCreado.id, [asignadoFinal])
    else void notificarNuevaTarea(ticketCreado.id)

    setExito(true)
    setTipoId('')
    setTitulo('')
    setDescripcion('')
    setPrioridad('media')
    setFechaRequerida('')
    setFechaCompromiso('')
    setAsignadoA(asignadoAPorDefecto)
    setArchivos([])
    // Si los archivos fallaron, el formulario no se cierra solo: así se lee el aviso.
    if (errorArchivos) {
      setError(errorArchivos)
      return
    }
    setTimeout(() => onCreado?.(), 900)
  }

  // Solo para áreas con catálogo de tipos (p. ej. Talento Humano).
  const campoTipo = tipos.length > 0 && (
    <label>
      Tipo de solicitud
      <select value={tipoId} onChange={(e) => setTipoId(e.target.value)} required>
        <option value="" disabled>-- Selecciona --</option>
        {tipos.map((tipo) => (
          <option key={tipo.id} value={tipo.id}>{tipo.nombre}</option>
        ))}
      </select>
    </label>
  )

  const campoFecha = (
    <label>
      {/* En el modal del tablero va en una fila de tres campos: texto corto. */}
      <span>{elegirArea ? 'Para cuándo la necesitas' : 'Para cuándo'} <small className="ticket-form__opcional">Opcional</small></span>
      <input
        type="date"
        value={fechaRequerida}
        min={hoyLocal()}
        onChange={(e) => setFechaRequerida(e.target.value)}
      />
    </label>
  )

  const campoTitulo = (
    <>
      <label>
        Título
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          required
          maxLength={140}
          spellCheck
          lang="es"
          placeholder={elegirArea ? 'Ej.: Actualizar el reporte mensual de ventas' : undefined}
        />
      </label>
      <SugerenciasTexto texto={titulo} onCambiar={setTitulo} />
    </>
  )

  const campoDescripcion = (
    <>
      <label>
        Descripción
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          required
          rows={5}
          spellCheck
          lang="es"
          placeholder={elegirArea ? 'Cuenta qué necesitas, para cuándo y cualquier detalle que ayude a resolverlo.' : undefined}
        />
      </label>
      <SugerenciasTexto texto={descripcion} onCambiar={setDescripcion} />
      <AsistenteSolicitud
        titulo={titulo}
        descripcion={descripcion}
        area={todasLasAreas.find((a) => a.id === areaId)?.nombre ?? areaActiva?.nombre}
        tipo={tipos.find((t) => t.id === tipoId)?.nombre}
        onUsar={(nuevoTitulo, nuevaDescripcion) => {
          setTitulo(nuevoTitulo)
          setDescripcion(nuevaDescripcion)
        }}
      />
    </>
  )

  const campoAdjunto = (
    <div className="ticket-form__attachment-field">
      {!elegirArea && <span className="ticket-form__attachment-label">Adjuntar archivos <small>Opcional</small></span>}
      <input
        ref={archivoInputRef}
        type="file"
        multiple
        accept={EXTENSIONES_PERMITIDAS.map((ext) => `.${ext}`).join(',')}
        onChange={handleArchivoChange}
        className="ticket-form__file-input"
        tabIndex={-1}
      />
      {archivos.length > 0 && (
        <ul className="ticket-form__archivos">
          {archivos.map((file, i) => (
            <li key={`${file.name}-${file.size}`} className="ticket-form__attachment-file">
              <VistaPreviaArchivo archivo={file} />
              <div className="ticket-form__attachment-info">
                <strong title={file.name}>{file.name}</strong>
                <span>{pesoLegible(file.size)}</span>
              </div>
              <button type="button" className="ticket-form__attachment-remove" onClick={() => quitarArchivo(i)} aria-label={`Quitar ${file.name}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {archivos.length < ARCHIVOS_POR_SOLICITUD && (
        <div
          className={`ticket-form__dropzone${arrastrandoArchivo ? ' ticket-form__dropzone--activo' : ''}${archivos.length > 0 ? ' ticket-form__dropzone--compacta' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="Seleccionar archivos para adjuntar"
          onClick={() => archivoInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              archivoInputRef.current?.click()
            }
          }}
          onDragEnter={(e) => {
            e.preventDefault()
            setArrastrandoArchivo(true)
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setArrastrandoArchivo(false)
          }}
          onDrop={handleArchivoDrop}
        >
          <div className="ticket-form__attachment-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
            </svg>
          </div>
          <div>
            <p>{archivos.length > 0 ? 'Agrega más archivos aquí o' : 'Arrastra uno o varios archivos aquí o'}</p>
            <span className="ticket-form__file-button">Seleccionar archivos</span>
          </div>
          <span>
            Imagen, PDF, Word, Excel, PowerPoint, TXT, CSV o ZIP · hasta {ARCHIVOS_POR_SOLICITUD} archivos de máximo {ARCHIVO_MAX_MB} MB
          </span>
        </div>
      )}
    </div>
  )

  // Desde el tablero (modal): formulario compacto, fijo en el área activa.
  if (!elegirArea) {
    return (
      // El área es siempre la activa (va en el encabezado del modal); para
      // enviarla a otra área está Nueva solicitud.
      <form onSubmit={handleSubmit} className="nueva-tarea">
        <div className="nueva-tarea__cuerpo">
          {campoTipo}
          {campoTitulo}
          {campoDescripcion}

          <div className="nueva-tarea__campo">
            <span className="nueva-tarea__etiqueta">Prioridad</span>
            <div className="segmentado nueva-tarea__prioridad" role="radiogroup" aria-label="Prioridad">
              {PRIORIDADES.map((p) => (
                <button
                  key={p.valor}
                  type="button"
                  role="radio"
                  aria-checked={prioridad === p.valor}
                  aria-pressed={prioridad === p.valor}
                  title={p.ayuda}
                  onClick={() => setPrioridad(p.valor)}
                >
                  <span className={`propiedad__punto propiedad__punto--${p.valor}`} aria-hidden="true" />
                  {p.etiqueta}
                </button>
              ))}
            </div>
          </div>

          <div className="ticket-form__row">
            {rolEnDestino === 'lider' && (
              <label>
                Asignar a
                <SelectorPersona
                  personas={equipo}
                  valor={asignadoA}
                  onCambiar={setAsignadoA}
                  opcionesFijas={[{ valor: '', etiqueta: 'Sin asignar (bandeja)' }]}
                  etiquetaPersona={(p) => (p.id === profile?.id ? 'A mí' : p.full_name ?? p.email)}
                  placeholder="Sin asignar (bandeja)"
                />
              </label>
            )}
            {campoFecha}
            {(rolEnDestino === 'agente' || rolEnDestino === 'lider') && (
              <label title="Fecha y hora a la que el equipo se compromete a terminarla. Si queda vacía, el vencimiento se mide contra “Para cuándo”.">
                <span>Compromiso <small className="ticket-form__opcional">Opcional</small></span>
                <input
                  type="datetime-local"
                  value={fechaCompromiso}
                  min={ahoraLocal()}
                  onChange={(e) => setFechaCompromiso(e.target.value)}
                />
              </label>
            )}
          </div>

          {campoAdjunto}
        </div>

        <footer className="detalle__footer">
          {error ? (
            <p className="auth-error">{error}</p>
          ) : exito ? (
            <p className="auth-success nueva-tarea__estado">Tarea creada correctamente.</p>
          ) : (
            <span className="detalle__estado-guardado">Se crea en {areaActiva?.nombre ?? 'el área activa'}</span>
          )}
          <div className="nueva-tarea__acciones">
            {onCancelar && (
              <button type="button" className="boton-secundario" onClick={onCancelar} disabled={enviando}>
                Cancelar
              </button>
            )}
            <button type="submit" disabled={enviando || exito}>
              {enviando ? 'Creando…' : 'Crear tarea'}
            </button>
          </div>
        </footer>
      </form>
    )
  }

  // Solicitud a cualquier área: pasos numerados con el destino siempre visible.
  const indiceDestino = todasLasAreas.findIndex((a) => a.id === areaDestinoId)
  const areaDestino = indiceDestino >= 0 ? todasLasAreas[indiceDestino] : null
  const personaDestino = personasDestino.find((p) => p.id === asignadoA)
  const detalleCompleto = titulo.trim() !== '' && descripcion.trim() !== '' && (tipos.length === 0 || tipoId !== '')

  return (
    <form onSubmit={handleSubmit} className="solicitud-form">
      <section className="solicitud-paso">
        <PasoEncabezado
          numero={1}
          completo={!!areaDestino}
          titulo="¿A qué área se la envías?"
          ayuda="Llega a la bandeja general de esa área para que su equipo la tome, o directo a la persona que elijas."
        />
        {cargandoAreas ? (
          <p className="solicitud-areas__vacio">Cargando áreas…</p>
        ) : (
          <div className="solicitud-areas" role="radiogroup" aria-label="Área destino">
            {todasLasAreas.map((area, i) => {
              const seleccionada = area.id === areaDestinoId
              return (
                <label
                  key={area.id}
                  className={`solicitud-area${seleccionada ? ' solicitud-area--seleccionada' : ''}`}
                  style={estiloArea(i)}
                >
                  <input
                    type="radio"
                    name="area-destino"
                    value={area.id}
                    checked={seleccionada}
                    onChange={() => setAreaDestinoId(area.id)}
                    required
                  />
                  <span className="solicitud-area__avatar" aria-hidden="true">
                    {iniciales(area.nombre)}
                  </span>
                  <span className="solicitud-area__texto">
                    <strong>{area.nombre}</strong>
                  </span>
                  <span className="solicitud-area__check" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                </label>
              )
            })}
          </div>
        )}
        {areaDestino && personasDestino.length > 0 && (
          <label className="solicitud-paso__persona">
            <span>¿A alguien en particular? <small className="ticket-form__opcional">Opcional</small></span>
            <SelectorPersona
              personas={personasDestino}
              valor={asignadoA}
              onCambiar={setAsignadoA}
              opcionesFijas={[{ valor: '', etiqueta: `Cualquiera de ${areaDestino.nombre} (bandeja)` }]}
              etiquetaPersona={(p) => (p.id === profile?.id ? 'A mí' : p.full_name ?? p.email)}
              placeholder={`Cualquiera de ${areaDestino.nombre} (bandeja)`}
            />
          </label>
        )}
      </section>

      <section className="solicitud-paso">
        <PasoEncabezado
          numero={2}
          completo={detalleCompleto}
          titulo="¿Qué necesitas?"
          ayuda="Un título corto y una descripción clara ayudan a que la atiendan más rápido."
        />
        <div className="solicitud-paso__campos">
          {campoTipo}
          {campoTitulo}
          {campoDescripcion}
        </div>
      </section>

      <section className="solicitud-paso">
        <PasoEncabezado
          numero={3}
          completo
          titulo="¿Qué tan urgente es?"
          ayuda="Si la necesitas para una fecha concreta, indícala: el equipo la verá en la tarjeta y se marcará si se vence."
        />
        <div className="solicitud-prioridades" role="radiogroup" aria-label="Prioridad">
          {PRIORIDADES.map((p) => (
            <label
              key={p.valor}
              className={`solicitud-prioridad${prioridad === p.valor ? ' solicitud-prioridad--seleccionada' : ''}`}
              style={{ '--prioridad-color': `var(--prioridad-${p.valor})` } as CSSProperties}
            >
              <input
                type="radio"
                name="prioridad"
                value={p.valor}
                checked={prioridad === p.valor}
                onChange={() => setPrioridad(p.valor)}
              />
              <span className="solicitud-prioridad__punto" aria-hidden="true" />
              <span className="solicitud-prioridad__texto">
                <strong>{p.etiqueta}</strong>
                <small>{p.ayuda}</small>
              </span>
            </label>
          ))}
        </div>
        <div className="solicitud-paso__fecha">{campoFecha}</div>
      </section>

      <section className="solicitud-paso">
        <PasoEncabezado numero={4} completo={archivos.length > 0} titulo="Adjunta archivos" opcional />
        {campoAdjunto}
      </section>

      {error && <p className="auth-error">{error}</p>}
      {exito && (
        <p className="auth-success">Solicitud enviada. Puedes seguirla en Mis solicitudes.</p>
      )}

      <div className="solicitud-resumen">
        {areaDestino ? (
          <div className="solicitud-resumen__destino" style={estiloArea(indiceDestino)}>
            <span className="solicitud-area__avatar" aria-hidden="true">
              {iniciales(areaDestino.nombre)}
            </span>
            <span className="solicitud-resumen__texto">
              <small>Se enviará a</small>
              <strong>
                {areaDestino.nombre}
                {personaDestino && ` · ${personaDestino.full_name ?? personaDestino.email}`}
              </strong>
            </span>
          </div>
        ) : (
          <p className="solicitud-resumen__pendiente">Elige primero a qué área va la solicitud</p>
        )}
        <button type="submit" disabled={enviando || !areaDestino}>
          {enviando ? 'Enviando…' : areaDestino ? `Enviar a ${areaDestino.nombre}` : 'Enviar solicitud'}
        </button>
      </div>
    </form>
  )
}

// Miniatura de una imagen elegida (antes de subirla) o el ícono del tipo.
function VistaPreviaArchivo({ archivo }: { archivo: File }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!esImagen(archivo.name)) return
    const objeto = URL.createObjectURL(archivo)
    setUrl(objeto)
    return () => URL.revokeObjectURL(objeto)
  }, [archivo])

  if (url) return <img src={url} alt="" className="ticket-form__archivo-preview" />
  return <IconoArchivo nombre={archivo.name} />
}

interface PasoEncabezadoProps {
  numero: number
  completo: boolean
  titulo: string
  ayuda?: string
  opcional?: boolean
}

function PasoEncabezado({ numero, completo, titulo, ayuda, opcional }: PasoEncabezadoProps) {
  return (
    <header className="solicitud-paso__encabezado">
      <span className={`solicitud-paso__numero${completo ? ' solicitud-paso__numero--completo' : ''}`} aria-hidden="true">
        {completo ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        ) : (
          numero
        )}
      </span>
      <div>
        <span className="solicitud-paso__etiqueta">
          Paso {numero}
          {opcional && ' · Opcional'}
        </span>
        <h2>{titulo}</h2>
        {ayuda && <p>{ayuda}</p>}
      </div>
    </header>
  )
}
