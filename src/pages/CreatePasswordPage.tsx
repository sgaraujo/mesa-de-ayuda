import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function CreatePasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [advertencia, setAdvertencia] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setAdvertencia(null)

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (password !== confirmacion) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setEnviando(true)
    const { data, error } = await supabase.auth.updateUser({ password })
    if (error) {
      setEnviando(false)
      setError('No se pudo guardar la contraseña. El enlace pudo haber expirado.')
      return
    }

    const correo = data.user?.email
    if (correo) {
      const { error: errorCorreo } = await supabase.functions.invoke('send-welcome-email', {
        body: { email: correo },
      })

      if (errorCorreo) {
        console.error('No se pudo enviar el correo de bienvenida:', errorCorreo)
        setEnviando(false)
        setAdvertencia(
          'Tu contraseña quedó guardada, pero no pudimos enviar el correo de bienvenida. Ya puedes iniciar sesión normalmente.',
        )
        return
      }
    }

    setEnviando(false)
    navigate('/tablero')
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Crea tu contraseña</h1>
        <label>
          Nueva contraseña
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Confirmar contraseña
          <input
            type="password"
            required
            minLength={8}
            value={confirmacion}
            onChange={(e) => setConfirmacion(e.target.value)}
          />
        </label>
        {error && <p className="auth-error">{error}</p>}
        {advertencia && (
          <>
            <p className="auth-error">{advertencia}</p>
            <button type="button" onClick={() => navigate('/login')}>
              Ir a iniciar sesión
            </button>
          </>
        )}
        {!advertencia && (
          <button type="submit" disabled={enviando}>
            {enviando ? 'Guardando y enviando...' : 'Guardar y continuar'}
          </button>
        )}
      </form>
    </div>
  )
}
