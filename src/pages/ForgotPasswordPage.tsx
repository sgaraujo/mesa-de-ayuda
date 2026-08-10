import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setEnviando(true)
    const { error: errorEnvio } = await supabase.functions.invoke('reset-password', {
      body: { email: email.trim().toLowerCase() },
    })
    setEnviando(false)

    if (errorEnvio) {
      setError('No pudimos procesar la solicitud. Intenta nuevamente.')
      return
    }
    setEnviado(true)
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Recuperar contraseña</h1>
        {enviado ? (
          <>
            <p className="auth-hint">
              Si el correo está registrado, recibirás un enlace para crear una nueva contraseña.
            </p>
            <Link className="auth-link-button" to="/login">Volver a iniciar sesión</Link>
          </>
        ) : (
          <>
            <p className="auth-hint">Ingresa el correo con el que accedes a la Mesa de Ayuda.</p>
            <label>
              Correo corporativo
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" disabled={enviando}>{enviando ? 'Enviando...' : 'Enviar enlace'}</button>
            <p className="auth-footer"><Link to="/login">Volver a iniciar sesión</Link></p>
          </>
        )}
      </form>
    </div>
  )
}
