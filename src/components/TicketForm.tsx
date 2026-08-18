import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useAreas } from '../hooks/useAreas'
import type { Prioridad } from '../types/database'
import { notificarAsignacion, notificarNuevaTarea } from '../lib/notificaciones'

const IMAGEN_MAX_MB = 5

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
  const [imagen, setImagen] = useState<File | null>(null)
  const [imagenPreview, setImagenPreview] = useState<string | null>(null)
  const [arrastrandoImagen, setArrastrandoImagen] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState(false)
  const imagenInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!imagen) {
      setImagenPreview(null)
      return
    }
    const url = URL.createObjectURL(imagen)
    setImagenPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [imagen])

  function seleccionarImagen(file: File | null) {
    if (file && !file.type.startsWith('image/')) {
      setError('El archivo debe ser una imagen.')
      if (imagenInputRef.current) imagenInputRef.current.value = ''
      setImagen(null)
      return
    }
    if (file && file.size > IMAGEN_MAX_MB * 1024 * 1024) {
      setError(`La imagen no puede pesar más de ${IMAGEN_MAX_MB} MB.`)
      if (imagenInputRef.current) imagenInputRef.current.value = ''
      setImagen(null)
      return
    }
    setError(null)
    setImagen(file)
  }

  function handleImagenChange(e: ChangeEvent<HTMLInputElement>) {
    seleccionarImagen(e.target.files?.[0] ?? null)
  }

  function handleImagenDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setArrastrandoImagen(false)
    seleccionarImagen(e.dataTransfer.files?.[0] ?? null)
  }

  function quitarImagen() {
    setImagen(null)
    setError(null)
    if (imagenInputRef.current) imagenInputRef.current.value = ''
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

    let imagenUrl: string | null = null
    if (imagen) {
      const extension = imagen.name.includes('.') ? imagen.name.split('.').pop() : 'jpg'
      const ruta = `${crypto.randomUUID()}.${extension}`
      const { error: errorSubida } = await supabase.storage.from('ticket-imagenes').upload(ruta, imagen)

      if (errorSubida) {
        setEnviando(false)
        setError('No se pudo subir la imagen. Intenta de nuevo.')
        return
      }
      imagenUrl = supabase.storage.from('ticket-imagenes').getPublicUrl(ruta).data.publicUrl
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
        imagen_url: imagenUrl,
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
    setImagen(null)
    if (imagenInputRef.current) imagenInputRef.current.value = ''
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
        <span className="ticket-form__attachment-label">Adjuntar imagen <small>Opcional</small></span>
        <input
          ref={imagenInputRef}
          type="file"
          accept="image/*"
          onChange={handleImagenChange}
          className="ticket-form__file-input"
          tabIndex={-1}
        />
        {!imagen ? (
          <div
            className={`ticket-form__dropzone${arrastrandoImagen ? ' ticket-form__dropzone--activo' : ''}`}
            role="button"
            tabIndex={0}
            aria-label="Seleccionar una imagen para adjuntar"
            onClick={() => imagenInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                imagenInputRef.current?.click()
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault()
              setArrastrandoImagen(true)
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setArrastrandoImagen(false)
            }}
            onDrop={handleImagenDrop}
          >
            <div className="ticket-form__attachment-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
              </svg>
            </div>
            <div>
              <p>Arrastra una imagen aquí o</p>
              <span className="ticket-form__file-button">Seleccionar imagen</span>
            </div>
            <span>PNG, JPG, WEBP o GIF · máximo {IMAGEN_MAX_MB} MB</span>
          </div>
        ) : (
          <div className="ticket-form__attachment-file">
            {imagenPreview && <img src={imagenPreview} alt="Vista previa" className="ticket-form__imagen-preview" />}
            <div className="ticket-form__attachment-info">
              <strong title={imagen.name}>{imagen.name}</strong>
              <span>{pesoLegible(imagen.size)}</span>
            </div>
            <button type="button" className="ticket-form__attachment-remove" onClick={quitarImagen} aria-label={`Quitar ${imagen.name}`}>
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
