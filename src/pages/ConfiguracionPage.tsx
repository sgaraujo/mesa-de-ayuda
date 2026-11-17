import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Las cuentas de ingreso por cédula sin correo corporativo usan un correo
// interno (supabase/functions/_shared/cedula.ts) al que nunca se envía nada.
const esCorreoInterno = (correo: string) => correo.toLowerCase().endsWith('@cedula.local')

export function ConfiguracionPage() {
  const { profile, refrescarPerfil } = useAuth()
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  if (!profile) return null

  const sinBuzon = esCorreoInterno(profile.email)

  async function cambiarRecibirCorreos(valor: boolean) {
    if (!profile) return
    setMensaje(null)
    setGuardando(true)
    const { error } = await supabase
      .from('profiles')
      .update({ recibir_correos: valor })
      .eq('id', profile.id)
    if (error) {
      setGuardando(false)
      setMensaje({ tipo: 'error', texto: 'No se pudo guardar la preferencia. Intenta de nuevo.' })
      return
    }
    await refrescarPerfil()
    setGuardando(false)
    setMensaje({
      tipo: 'ok',
      texto: valor
        ? 'Listo: te enviaremos correos de la actividad de tus tareas.'
        : 'Listo: ya no te enviaremos correos de la actividad. Seguirás viendo todo en la campanita.',
    })
  }

  return (
    <div className="page-form">
      <h1>Configuración</h1>
      <p className="page-form__subtitulo">Elige cómo quieres enterarte de la actividad de tus tareas.</p>

      <section className="configuracion__seccion">
        <h2>Notificaciones por correo</h2>
        <label className="interruptor">
          <input
            type="checkbox"
            checked={profile.recibir_correos && !sinBuzon}
            disabled={guardando || sinBuzon}
            onChange={(e) => cambiarRecibirCorreos(e.target.checked)}
          />
          <span className="interruptor__pista" aria-hidden="true" />
          Recibir correos de mis notificaciones
        </label>
        <p className="configuracion__ayuda">
          {sinBuzon
            ? 'Tu cuenta no tiene correo corporativo, así que los avisos te llegan solo a la campanita de la app.'
            : `Asignaciones, menciones, tareas finalizadas o rechazadas y alertas de vencimiento, enviadas a ${profile.email}. La campanita de la app te avisa siempre, aunque desactives los correos.`}
        </p>
        {mensaje && (
          <p className={mensaje.tipo === 'ok' ? 'configuracion__ok' : 'auth-error'} role="status">
            {mensaje.texto}
          </p>
        )}
      </section>
    </div>
  )
}
