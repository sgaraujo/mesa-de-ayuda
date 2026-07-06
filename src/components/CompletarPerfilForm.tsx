import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useAreas } from '../hooks/useAreas'

export function CompletarPerfilForm() {
  const { profile, refrescarPerfil } = useAuth()
  const { areas } = useAreas()

  const [nombre, setNombre] = useState(profile?.full_name ?? '')
  const [areaId, setAreaId] = useState(profile?.area_id ?? '')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setError(null)
    setGuardando(true)

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: nombre.trim(), area_id: areaId || null })
      .eq('id', profile.id)

    if (error) {
      setGuardando(false)
      setError('No se pudo guardar. Intenta de nuevo.')
      return
    }

    await refrescarPerfil()
    setGuardando(false)
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Completa tu perfil</h1>
        <p className="auth-hint">
          Necesitamos tu nombre y área para que aparezcas correctamente en el tablero y las
          estadísticas.
        </p>
        <label>
          Nombre completo
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            placeholder="Tu nombre y apellido"
          />
        </label>
        <label>
          Área
          <select value={areaId} onChange={(e) => setAreaId(e.target.value)} required>
            <option value="" disabled>
              Selecciona un área
            </option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.nombre}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" disabled={guardando}>
          {guardando ? 'Guardando...' : 'Continuar'}
        </button>
      </form>
    </div>
  )
}
