import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useAreas } from '../hooks/useAreas'
import { useAgentes } from '../hooks/useAgentes'
import type { Prioridad } from '../types/database'

const BANDEJA_GENERAL = ''

export function NewTicketPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const { areas } = useAreas()
  const { agentes } = useAgentes()

  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [areaId, setAreaId] = useState('')
  const [prioridad, setPrioridad] = useState<Prioridad>('media')
  const [asignadoA, setAsignadoA] = useState(BANDEJA_GENERAL)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    setEnviando(true)

    const { error } = await supabase.from('tickets').insert({
      titulo,
      descripcion,
      solicitante_id: profile.id,
      empresa_solicitante: profile.empresa,
      area_id: areaId || null,
      asignado_a: asignadoA || null,
      prioridad,
      estado: 'pendiente',
    })

    setEnviando(false)
    if (error) {
      setError('No se pudo crear la solicitud. Intenta de nuevo.')
      return
    }
    setExito(true)
    setTimeout(() => navigate('/tablero'), 1200)
  }

  return (
    <div className="page-form">
      <h1>Nueva solicitud</h1>
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
          Asignar a
          <select value={asignadoA} onChange={(e) => setAsignadoA(e.target.value)}>
            <option value={BANDEJA_GENERAL}>Bandeja general del equipo</option>
            {agentes.map((agente) => (
              <option key={agente.id} value={agente.id}>
                {agente.full_name ?? agente.email}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="auth-error">{error}</p>}
        {exito && <p className="auth-success">Solicitud creada correctamente.</p>}
        <button type="submit" disabled={enviando}>
          {enviando ? 'Enviando...' : 'Crear solicitud'}
        </button>
      </form>
    </div>
  )
}
