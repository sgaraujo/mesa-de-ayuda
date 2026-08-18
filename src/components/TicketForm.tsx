import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useAreas } from '../hooks/useAreas'
import type { Prioridad } from '../types/database'
import { notificarAsignacion, notificarNuevaTarea } from '../lib/notificaciones'

const ARCHIVO_MAX_MB = 10
const EXTENSIONES_PERMITIDAS = [
  'png', 'jpg', 'jpeg', 'webp', 'gif',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip',
]

function extensionDe(nombreArchivo: string): string {
  return nombreArchivo.includes('.') ? nombreArchivo.split('.').pop()!.toLowerCase() : ''
}

interface TicketFormProps {
  asignadoAPorDefecto?: string
  onCreado?: () => void
}

export function TicketForm({ asignadoAPorDefecto = '', onCreado }: TicketFormProps) {
  const { profile } = useAuth()
  const { areas } = useAreas()
  const esSolicitante = profile?.role === 'solicitante'

  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [areaId, setAreaId] = useState('')
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
    if (!profile) return
    setError(null)
    setEnviando(true)
    const puedeAutoasignarse = profile.role === 'agente' || profile.role === 'admin'

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
        area_id: areaId || null,
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
    setAreaId('')
    setPrioridad('media')
    setArchivo(null)
    if (archivoInputRef.current) archivoInputRef.current.value = ''
    setTimeout(() => onCreado?.(), 900)
  }

  return (
    <form onSubmit={handleSubmit} className="ticket-form">
      <label>
        Título
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} required maxLength={140} />
      </label>
      <label>
        Descripción
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          required
          rows={5}
        />
      </label>
      <div className="ticket-form__row">
        {!esSolicitante && (
          <label>
            Área responsable
            <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">Sin definir</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Prioridad
          <select value={prioridad} onChange={(e) => setPrioridad(e.target.value as Prioridad)}>
            <option value="baja">Baja</option>
            <option value="media">Media</option>
            <option value="alta">Alta</option>
            <option value="urgente">Urgente</option>
          </select>
        </label>
      </div>
      <div className="ticket-form__attachment-field">
        <span className="ticket-form__attachment-label">Adjuntar archivo <small>Opcional</small></span>
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
      {error && <p className="auth-error">{error}</p>}
      {exito && <p className="auth-success">Solicitud creada correctamente.</p>}
      <button type="submit" disabled={enviando}>
        {enviando ? 'Enviando...' : 'Crear solicitud'}
      </button>
    </form>
  )
}
