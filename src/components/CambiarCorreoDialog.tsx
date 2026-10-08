import { useEffect, useRef, useState } from 'react'
import { dominioDeCorreo, nombreEmpresa } from '../lib/dominio'

const DOMINIOS_PERMITIDOS = ['inteegra.net.co', 'triangulum.net.co', 'netcol.net.co']

interface CambiarCorreoDialogProps {
  email: string | null
  procesando: boolean
  error: string | null
  onConfirmar: (emailNuevo: string) => void
  onCerrar: () => void
}

// Diálogo para cambiar el correo de una persona de la whitelist. El cambio
// real lo hace la Edge Function admin-change-email.
export function CambiarCorreoDialog({ email, procesando, error, onConfirmar, onCerrar }: CambiarCorreoDialogProps) {
  const [nuevo, setNuevo] = useState('')
  const [errorLocal, setErrorLocal] = useState<string | null>(null)
  const campoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!email) return
    setNuevo(email)
    setErrorLocal(null)
    requestAnimationFrame(() => {
      campoRef.current?.focus()
      campoRef.current?.select()
    })
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

  const normalizado = nuevo.trim().toLowerCase()
  const cambiaEmpresa = normalizado.includes('@') && dominioDeCorreo(normalizado) !== dominioDeCorreo(email)

  return (
    <div className="modal-overlay" onMouseDown={() => !procesando && onCerrar()}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cambiar-correo-titulo"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-panel__header">
          <h2 id="cambiar-correo-titulo">Cambiar correo</h2>
          <button type="button" className="modal-close" onClick={onCerrar} aria-label="Cerrar" disabled={procesando}>
            ×
          </button>
        </div>

        <form
          className="set-password__form"
          onSubmit={(event) => {
            event.preventDefault()
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizado)) {
              setErrorLocal('Escribe un correo válido.')
              return
            }
            if (!DOMINIOS_PERMITIDOS.includes(dominioDeCorreo(normalizado))) {
              setErrorLocal(`El correo debe ser de ${DOMINIOS_PERMITIDOS.join(', ')}.`)
              return
            }
            if (normalizado === email.toLowerCase()) {
              setErrorLocal('El correo nuevo es igual al actual.')
              return
            }
            setErrorLocal(null)
            onConfirmar(normalizado)
          }}
        >
          <p className="modal-descripcion">
            Correo actual: <strong>{email}</strong>. Si la persona ya tiene cuenta, desde ahora inicia sesión con el
            correo nuevo y la <strong>misma contraseña</strong>. Sus áreas, roles y tareas se conservan.
          </p>
          <label>
            Correo nuevo
            <input
              ref={campoRef}
              type="email"
              value={nuevo}
              onChange={(e) => {
                setNuevo(e.target.value)
                setErrorLocal(null)
              }}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          {cambiaEmpresa && DOMINIOS_PERMITIDOS.includes(dominioDeCorreo(normalizado)) && (
            <p className="admin-table__texto-sutil">
              La empresa de la persona pasará de {nombreEmpresa(email)} a {nombreEmpresa(normalizado)}.
            </p>
          )}
          {(errorLocal || error) && <p className="auth-error">{errorLocal ?? error}</p>}
          <div className="confirm-dialog__acciones">
            <button type="button" className="confirm-dialog__cancelar" onClick={onCerrar} disabled={procesando}>
              Cancelar
            </button>
            <button type="submit" disabled={procesando}>
              {procesando ? 'Cambiando...' : 'Cambiar correo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
