import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useAreas } from '../hooks/useAreas'
import type { Prioridad } from '../types/database'

const IMAGEN_MAX_MB = 5

interface TicketFormProps {
  asignadoAPorDefecto?: string
  onCreado?: () => void
}

export function TicketForm({ asignadoAPorDefecto = '', onCreado }: TicketFormProps) {
  const { profile } = useAuth()
  const { areas } = useAreas()

  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [areaId, setAreaId] = useState('')
  const [prioridad, setPrioridad] = useState<Prioridad>('media')
  const [imagen, setImagen] = useState<File | null>(null)
  const [imagenPreview, setImagenPreview] = useState<string | null>(null)
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

  function handleImagenChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    if (file && file.size > IMAGEN_MAX_MB * 1024 * 1024) {
      setError(`La imagen no puede pesar más de ${IMAGEN_MAX_MB} MB.`)
      if (imagenInputRef.current) imagenInputRef.current.value = ''
      setImagen(null)
      return
    }
    setError(null)
    setImagen(file)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    setEnviando(true)

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

    const { error } = await supabase.from('tickets').insert({
      titulo,
      descripcion,
      solicitante_id: profile.id,
      empresa_solicitante: profile.empresa,
      area_id: areaId || null,
      asignado_a: asignadoAPorDefecto || null,
      prioridad,
      estado: 'pendiente',
      imagen_url: imagenUrl,
    })

    setEnviando(false)
    if (error) {
      setError('No se pudo crear la solicitud. Intenta de nuevo.')
      return
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
      <label>
        Imagen (opcional)
        <input
          ref={imagenInputRef}
          type="file"
          accept="image/*"
          onChange={handleImagenChange}
        />
      </label>
      {imagenPreview && (
        <img src={imagenPreview} alt="Vista previa" className="ticket-form__imagen-preview" />
      )}
      {error && <p className="auth-error">{error}</p>}
      {exito && <p className="auth-success">Solicitud creada correctamente.</p>}
      <button type="submit" disabled={enviando}>
        {enviando ? 'Enviando...' : 'Crear solicitud'}
      </button>
    </form>
  )
}
