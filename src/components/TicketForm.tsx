import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useArea } from '../context/AreaContext'
import { useAreas } from '../hooks/useAreas'
import type { Prioridad } from '../types/database'
import { notificarAsignacion, notificarNuevaTarea } from '../lib/notificaciones'

const ARCHIVO_MAX_MB = 10
const EXTENSIONES_PERMITIDAS = [
  'png', 'jpg', 'jpeg', 'webp', 'gif',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip',
]

const PRIORIDADES: { valor: Prioridad; etiqueta: string; ayuda: string }[] = [
  { valor: 'baja', etiqueta: 'Baja', ayuda: 'Cuando haya tiempo' },
  { valor: 'media', etiqueta: 'Media', ayuda: 'En los próximos días' },
  { valor: 'alta', etiqueta: 'Alta', ayuda: 'Lo antes posible' },
  { valor: 'urgente', etiqueta: 'Urgente', ayuda: 'Bloquea el trabajo' },
]

function extensionDe(nombreArchivo: string): string {
  return nombreArchivo.includes('.') ? nombreArchivo.split('.').pop()!.toLowerCase() : ''
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
  // true: se elige a qué área enviar la solicitud (cualquiera, sea o no
  // miembro). false: se crea en el área activa, como desde el tablero.
  elegirArea?: boolean
  onCreado?: () => void
  onDirtyChange?: (dirty: boolean) => void
}

export function TicketForm({ asignadoAPorDefecto = '', elegirArea = false, onCreado, onDirtyChange }: TicketFormProps) {
  const { profile } = useAuth()
  const { areaActiva, areas: misAreas } = useArea()
  const { areas: todasLasAreas, loading: cargandoAreas } = useAreas()
  // Sin área preseleccionada: quien envía la solicitud debe elegir el destino a conciencia.
  const [areaDestinoId, setAreaDestinoId] = useState('')
  const areaId = elegirArea ? areaDestinoId : areaActiva?.id ?? ''
  const rolEnDestino = misAreas.find((a) => a.id === areaId)?.rol

  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [prioridad, setPrioridad] = useState<Prioridad>('media')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [archivoPreview, setArchivoPreview] = useState<string | null>(null)
  const [arrastrandoArchivo, setArrastrandoArchivo] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState(false)
  const archivoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!archivo || !archivo.type.startsWith('image/')) {
      setArchivoPreview(null)
      return
    }
    const url = URL.createObjectURL(archivo)
    setArchivoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [archivo])

  useEffect(() => {
    onDirtyChange?.(titulo.trim() !== '' || descripcion.trim() !== '' || archivo !== null)
  }, [titulo, descripcion, archivo, onDirtyChange])

  function seleccionarArchivo(file: File | null) {
    if (file && !EXTENSIONES_PERMITIDAS.includes(extensionDe(file.name))) {
      setError('Formato no permitido. Usa imagen, PDF, Word, Excel, PowerPoint, TXT, CSV o ZIP.')
      if (archivoInputRef.current) archivoInputRef.current.value = ''
      setArchivo(null)
      return
    }
    if (file && file.size > ARCHIVO_MAX_MB * 1024 * 1024) {
      setError(`El archivo no puede pesar más de ${ARCHIVO_MAX_MB} MB.`)
      if (archivoInputRef.current) archivoInputRef.current.value = ''
      setArchivo(null)
      return
    }
    setError(null)
    setArchivo(file)
  }

  function handleArchivoChange(e: ChangeEvent<HTMLInputElement>) {
    seleccionarArchivo(e.target.files?.[0] ?? null)
  }

  function handleArchivoDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setArrastrandoArchivo(false)
    seleccionarArchivo(e.dataTransfer.files?.[0] ?? null)
  }

  function quitarArchivo() {
    setArchivo(null)
    setError(null)
    if (archivoInputRef.current) archivoInputRef.current.value = ''
  }

  function pesoLegible(bytes: number) {
    return bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile || !areaId) return
    setError(null)
    setEnviando(true)
    const puedeAutoasignarse = rolEnDestino === 'agente' || rolEnDestino === 'lider'

    let archivoUrl: string | null = null
    if (archivo) {
      const ruta = `${crypto.randomUUID()}.${extensionDe(archivo.name)}`
      const { error: errorSubida } = await supabase.storage.from('ticket-imagenes').upload(ruta, archivo)

      if (errorSubida) {
        setEnviando(false)
        setError('No se pudo subir el archivo. Intenta de nuevo.')
        return
      }
      archivoUrl = supabase.storage.from('ticket-imagenes').getPublicUrl(ruta).data.publicUrl
    }

    const asignadoA = puedeAutoasignarse ? asignadoAPorDefecto || null : null
    const { data: ticketCreado, error } = await supabase
      .from('tickets')
      .insert({
        titulo,
        descripcion,
        solicitante_id: profile.id,
        empresa_solicitante: profile.empresa,
        area_id: areaId,
        asignado_a: asignadoA,
        prioridad,
        estado: 'pendiente',
        archivo_url: archivoUrl,
      })
      .select('id')
      .single()

    setEnviando(false)
    if (error) {
      setError('No se pudo crear la solicitud. Intenta de nuevo.')
      return
    }

    if (ticketCreado) {
      if (asignadoA) void notificarAsignacion(ticketCreado.id, [asignadoA])
      else void notificarNuevaTarea(ticketCreado.id)
    }

    setExito(true)
    setTitulo('')
    setDescripcion('')
    setPrioridad('media')
    setArchivo(null)
    if (archivoInputRef.current) archivoInputRef.current.value = ''
    setTimeout(() => onCreado?.(), 900)
  }

  const campoTitulo = (
    <label>
      Título
      <input
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        required
        maxLength={140}
        placeholder={elegirArea ? 'Ej.: Actualizar el reporte mensual de ventas' : undefined}
      />
    </label>
  )

  const campoDescripcion = (
    <label>
      Descripción
      <textarea
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        required
        rows={5}
        placeholder={elegirArea ? 'Cuenta qué necesitas, para cuándo y cualquier detalle que ayude a resolverlo.' : undefined}
      />
    </label>
  )

  const campoAdjunto = (
    <div className="ticket-form__attachment-field">
      {!elegirArea && <span className="ticket-form__attachment-label">Adjuntar archivo <small>Opcional</small></span>}
      <input
        ref={archivoInputRef}
        type="file"
        accept={EXTENSIONES_PERMITIDAS.map((ext) => `.${ext}`).join(',')}
        onChange={handleArchivoChange}
        className="ticket-form__file-input"
        tabIndex={-1}
      />
      {!archivo ? (
        <div
          className={`ticket-form__dropzone${arrastrandoArchivo ? ' ticket-form__dropzone--activo' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="Seleccionar un archivo para adjuntar"
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
            <p>Arrastra un archivo aquí o</p>
            <span className="ticket-form__file-button">Seleccionar archivo</span>
          </div>
          <span>Imagen, PDF, Word, Excel, PowerPoint, TXT, CSV o ZIP · máximo {ARCHIVO_MAX_MB} MB</span>
        </div>
      ) : (
        <div className="ticket-form__attachment-file">
          {archivoPreview ? (
            <img src={archivoPreview} alt="Vista previa" className="ticket-form__archivo-preview" />
          ) : (
            <div className="ticket-form__archivo-icono" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
                <path d="M14 3v5h5" />
              </svg>
            </div>
          )}
          <div className="ticket-form__attachment-info">
            <strong title={archivo.name}>{archivo.name}</strong>
            <span>{pesoLegible(archivo.size)}</span>
          </div>
          <button type="button" className="ticket-form__attachment-remove" onClick={quitarArchivo} aria-label={`Quitar ${archivo.name}`}>
            ×
          </button>
        </div>
      )}
    </div>
  )

  // Desde el tablero (modal): formulario compacto en el área activa.
  if (!elegirArea) {
    return (
      <form onSubmit={handleSubmit} className="ticket-form">
        {campoTitulo}
        {campoDescripcion}
        <div className="ticket-form__row">
          <label>
            Área
            <input value={areaActiva?.nombre ?? ''} disabled />
          </label>
          <label>
            Prioridad
            <select value={prioridad} onChange={(e) => setPrioridad(e.target.value as Prioridad)}>
              {PRIORIDADES.map((p) => (
                <option key={p.valor} value={p.valor}>
                  {p.etiqueta}
                </option>
              ))}
            </select>
          </label>
        </div>
        {campoAdjunto}
        {error && <p className="auth-error">{error}</p>}
        {exito && <p className="auth-success">Solicitud creada correctamente.</p>}
        <button type="submit" disabled={enviando}>
          {enviando ? 'Enviando...' : 'Crear solicitud'}
        </button>
      </form>
    )
  }

  // Solicitud a cualquier área: pasos numerados con el destino siempre visible.
  const indiceDestino = todasLasAreas.findIndex((a) => a.id === areaDestinoId)
  const areaDestino = indiceDestino >= 0 ? todasLasAreas[indiceDestino] : null
  const detalleCompleto = titulo.trim() !== '' && descripcion.trim() !== ''

  return (
    <form onSubmit={handleSubmit} className="solicitud-form">
      <section className="solicitud-paso">
        <PasoEncabezado
          numero={1}
          completo={!!areaDestino}
          titulo="¿A qué área se la envías?"
          ayuda="La solicitud llega sin asignar a la bandeja general de esa área para que su equipo la tome."
        />
        {cargandoAreas ? (
          <p className="solicitud-areas__vacio">Cargando áreas…</p>
        ) : (
          <div className="solicitud-areas" role="radiogroup" aria-label="Área destino">
            {todasLasAreas.map((area, i) => {
              const seleccionada = area.id === areaDestinoId
              const miRol = misAreas.find((a) => a.id === area.id)?.rol
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
                    <small>{miRol ? `Eres ${miRol === 'lider' ? 'líder' : 'agente'} aquí` : 'Bandeja general'}</small>
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
      </section>

      <section className="solicitud-paso">
        <PasoEncabezado
          numero={2}
          completo={detalleCompleto}
          titulo="¿Qué necesitas?"
          ayuda="Un título corto y una descripción clara ayudan a que la atiendan más rápido."
        />
        <div className="solicitud-paso__campos">
          {campoTitulo}
          {campoDescripcion}
        </div>
      </section>

      <section className="solicitud-paso">
        <PasoEncabezado numero={3} completo titulo="¿Qué tan urgente es?" />
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
      </section>

      <section className="solicitud-paso">
        <PasoEncabezado numero={4} completo={!!archivo} titulo="Adjunta un archivo" opcional />
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
              <strong>{areaDestino.nombre}</strong>
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
