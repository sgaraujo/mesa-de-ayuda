import { useEffect, useRef, useState } from 'react'
import { PasswordInput } from './PasswordInput'

interface SetPasswordDialogProps {
  email: string | null
  procesando: boolean
  error: string | null
  contrasenaAsignada: string | null
  onConfirmar: (password: string) => void
  onCerrar: () => void
}

const ALFABETO_PASSWORD = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

function generarPassword(longitud = 12) {
  const valores = crypto.getRandomValues(new Uint32Array(longitud))
  return Array.from(valores, (n) => ALFABETO_PASSWORD[n % ALFABETO_PASSWORD.length]).join('')
}

export function SetPasswordDialog({
  email,
  procesando,
  error,
  contrasenaAsignada,
  onConfirmar,
  onCerrar,
}: SetPasswordDialogProps) {
  const [password, setPassword] = useState('')
  const [copiado, setCopiado] = useState(false)
  const [errorLocal, setErrorLocal] = useState<string | null>(null)
  const primerCampoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!email) return
    setPassword('')
    setCopiado(false)
    setErrorLocal(null)
    primerCampoRef.current?.focus()
  }, [email])

  useEffect(() => {
    if (!email) return
    function cerrarConEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !procesando) onCerrar()
    }
    document.addEventListener('keydown', cerrarConEscape)
    return () => document.removeEventListener('keydown', cerrarConEscape)
  }, [email, procesando, onCerrar])

  if (!email) return null

  async function copiarPassword() {
    if (!contrasenaAsignada) return
    try {
      await navigator.clipboard.writeText(contrasenaAsignada)
      setCopiado(true)
    } catch {
      setCopiado(false)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={() => !procesando && onCerrar()}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-password-titulo"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-panel__header">
          <h2 id="set-password-titulo">Asignar contraseña</h2>
          <button type="button" className="modal-close" onClick={onCerrar} aria-label="Cerrar" disabled={procesando}>
            ×
          </button>
        </div>

        {contrasenaAsignada ? (
          <>
            <p className="modal-descripcion">
              Contraseña asignada a <strong>{email}</strong>. Ya puede iniciar sesión con ella. Cópiala y
              compártela por un canal seguro (no vuelve a mostrarse).
            </p>
            <div className="set-password__resultado">
              <code>{contrasenaAsignada}</code>
              <button type="button" className="admin-table__accion-secundaria" onClick={copiarPassword}>
                {copiado ? 'Copiada' : 'Copiar'}
              </button>
            </div>
            <div className="confirm-dialog__acciones">
              <button type="button" onClick={onCerrar}>
                Listo
              </button>
            </div>
          </>
        ) : (
          <form
            className="set-password__form"
            onSubmit={(event) => {
              event.preventDefault()
              if (password.length < 8) {
                setErrorLocal('La contraseña debe tener al menos 8 caracteres.')
                return
              }
              setErrorLocal(null)
              onConfirmar(password)
            }}
          >
            <p className="modal-descripcion">
              Define la contraseña de <strong>{email}</strong>. Podrá iniciar sesión con ella de inmediato, sin
              esperar ningún correo.
            </p>
            <label>
              Contraseña
              <PasswordInput
                ref={primerCampoRef}
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setErrorLocal(null)
                }}
                placeholder="Mínimo 8 caracteres"
              />
            </label>
            <button
              type="button"
              className="admin-table__accion-secundaria set-password__generar"
              onClick={() => {
                setPassword(generarPassword())
                setErrorLocal(null)
              }}
            >
              Generar una segura
            </button>
            {(errorLocal || error) && <p className="auth-error">{errorLocal ?? error}</p>}
            <div className="confirm-dialog__acciones">
              <button type="button" className="confirm-dialog__cancelar" onClick={onCerrar} disabled={procesando}>
                Cancelar
              </button>
              <button type="submit" disabled={procesando}>
                {procesando ? 'Asignando...' : 'Asignar contraseña'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
