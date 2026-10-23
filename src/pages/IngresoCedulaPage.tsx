import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// Ingreso con cédula y código de un solo uso (Edge Function acceso-cedula,
// migración 0035). Es el enlace o QR que se comparte con quien no tiene
// correo corporativo: Nelyoda confirma que es empleado vigente y le envía el
// código.

type Paso = 'cedula' | 'codigo'

const MENSAJES: Record<string, string> = {
  cedula_invalida: 'Escribe tu número de cédula, solo números.',
  no_encontrado: 'No encontramos un empleado vigente con esa cédula. Si crees que es un error, comunícate con Talento Humano.',
  sin_contacto: 'No tienes un correo registrado para enviarte el código. Comunícate con Talento Humano para actualizar tus datos.',
  codigo_invalido: 'El código no es correcto. Revísalo e intenta de nuevo.',
  vencido: 'El código venció. Pide uno nuevo.',
  bloqueado: 'Superaste los intentos permitidos. Pide un código nuevo.',
  desactivado: 'Tu acceso a la Mesa de Ayuda está desactivado. Comunícate con el administrador.',
  limite_ip: 'Demasiados intentos desde esta red. Intenta de nuevo en una hora.',
}

interface Respuesta {
  ok: boolean
  motivo?: string
  destino?: string
  esperaMinutos?: number
  tokenHash?: string
}

export function IngresoCedulaPage() {
  const navigate = useNavigate()
  const [paso, setPaso] = useState<Paso>('cedula')
  const [cedula, setCedula] = useState('')
  const [codigo, setCodigo] = useState('')
  const [destino, setDestino] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function llamar(cuerpo: Record<string, string>): Promise<Respuesta> {
    const { data, error: errorInvocacion } = await supabase.functions.invoke('acceso-cedula', { body: cuerpo })
    if (data) return data as Respuesta
    // Respuestas que no son 2xx (límite por IP, error del servidor).
    const respuesta = await (errorInvocacion as { context?: Response })?.context?.json?.().catch(() => null)
    return (respuesta as Respuesta | null) ?? { ok: false, motivo: 'error' }
  }

  function mostrarError(respuesta: Respuesta) {
    if (respuesta.motivo === 'limite') {
      setError(`Ya pediste varios códigos. Espera ${respuesta.esperaMinutos ?? 60} minutos para pedir otro.`)
      return
    }
    setError(MENSAJES[respuesta.motivo ?? ''] ?? 'Ocurrió un problema. Intenta de nuevo en unos minutos.')
  }

  async function pedirCodigo(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    setEnviando(true)
    const respuesta = await llamar({ accion: 'solicitar', cedula })
    setEnviando(false)
    if (!respuesta.ok) {
      mostrarError(respuesta)
      return
    }
    setDestino(respuesta.destino ?? '')
    setCodigo('')
    setPaso('codigo')
  }

  async function verificar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setEnviando(true)
    const respuesta = await llamar({ accion: 'verificar', cedula, codigo })
    if (!respuesta.ok || !respuesta.tokenHash) {
      setEnviando(false)
      mostrarError(respuesta)
      return
    }
    const { error: errorSesion } = await supabase.auth.verifyOtp({ token_hash: respuesta.tokenHash, type: 'email' })
    setEnviando(false)
    if (errorSesion) {
      setError('No se pudo iniciar la sesión. Pide un código nuevo.')
      return
    }
    navigate('/nueva-solicitud', { replace: true })
  }

  if (paso === 'codigo') {
    return (
      <div className="auth-page">
        <form className="auth-card" onSubmit={verificar}>
          <h1>Escribe tu código</h1>
          <p className="auth-hint">
            Te enviamos un código de 6 dígitos a <strong>{destino}</strong>. Vence en 10 minutos.
          </p>
          <label>
            Código
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" disabled={enviando || codigo.length !== 6}>
            {enviando ? 'Verificando...' : 'Entrar'}
          </button>
          <p className="auth-footer">
            ¿No te llegó?{' '}
            <button type="button" className="auth-link-boton" onClick={() => void pedirCodigo()} disabled={enviando}>
              Enviar otro código
            </button>
            {' · '}
            <button type="button" className="auth-link-boton" onClick={() => { setPaso('cedula'); setError(null) }}>
              Cambiar cédula
            </button>
          </p>
        </form>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={pedirCodigo}>
        <h1>Entrar con mi cédula</h1>
        <p className="auth-hint">
          Para crear solicitudes a la Mesa de Ayuda. Te enviaremos un código para confirmar que eres tú.
        </p>
        <label>
          Número de cédula
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            required
            autoFocus
            maxLength={12}
            value={cedula}
            onChange={(e) => setCedula(e.target.value.replace(/\D/g, ''))}
            placeholder="Solo números"
          />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" disabled={enviando || cedula.length < 5}>
          {enviando ? 'Enviando código...' : 'Enviarme el código'}
        </button>
        <p className="auth-footer">
          ¿Tienes correo corporativo? <Link to="/login">Inicia sesión aquí</Link>
        </p>
      </form>
    </div>
  )
}
