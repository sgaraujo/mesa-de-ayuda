import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (password !== confirmacion) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setGuardando(true)
    const { error: errorCambio } = await supabase.auth.updateUser({ password })
    setGuardando(false)
    if (errorCambio) {
      setError('No se pudo cambiar la contraseña. El enlace pudo haber expirado; solicita uno nuevo.')
      return
    }

    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Nueva contraseña</h1>
        <p className="auth-hint">Crea una contraseña de al menos 8 caracteres.</p>
        <label>
          Nueva contraseña
          <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>
          Confirmar contraseña
          <input type="password" required minLength={8} autoComplete="new-password" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" disabled={guardando}>{guardando ? 'Guardando...' : 'Cambiar contraseña'}</button>
        {error && <p className="auth-footer"><Link to="/olvide-password">Solicitar otro enlace</Link></p>}
      </form>
    </div>
  )
}
