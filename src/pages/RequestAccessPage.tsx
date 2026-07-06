import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Estado = 'idle' | 'enviando' | 'enviado' | 'error'

export function RequestAccessPage() {
  const [email, setEmail] = useState('')
  const [estado, setEstado] = useState<Estado>('idle')
  const [mensajeError, setMensajeError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setEstado('enviando')
    setMensajeError(null)

    const { error } = await supabase.functions.invoke('invite-user', {
      body: { email: email.trim().toLowerCase() },
    })

    // La función siempre responde "ok" para no revelar si un correo está
    // en la whitelist; solo mostramos error ante una falla real del servidor.
    if (error) {
      setEstado('error')
      setMensajeError('Ocurrió un problema procesando la solicitud. Intenta de nuevo.')
      return
    }

    setEstado('enviado')
  }

  if (estado === 'enviado') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Revisa tu correo</h1>
          <p>
            Si tu correo está autorizado, te enviamos un enlace a <strong>{email}</strong> para
            que crees tu contraseña.
          </p>
          <p className="auth-footer">
            <Link to="/login">Volver al inicio de sesión</Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Solicitar acceso</h1>
        <p className="auth-hint">
          Disponible solo para correos de Inteegra, Triangulum y Netcol previamente autorizados.
        </p>
        <label>
          Correo corporativo
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nombre@triangulum.net.co"
          />
        </label>
        {estado === 'error' && <p className="auth-error">{mensajeError}</p>}
        <button type="submit" disabled={estado === 'enviando'}>
          {estado === 'enviando' ? 'Enviando...' : 'Enviar solicitud'}
        </button>
        <p className="auth-footer">
          ¿Ya tienes cuenta? <Link to="/login">Iniciar sesión</Link>
        </p>
      </form>
    </div>
  )
}
