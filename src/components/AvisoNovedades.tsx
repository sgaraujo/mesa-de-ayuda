import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { NOVEDADES, novedadesPendientes } from '../lib/novedades'
import { NovedadesModal } from './NovedadesModal'
import { useContextoNovedades } from '../hooks/useContextoNovedades'

// Abre "Novedades" sola, una vez por persona, cuando hay anuncios que no ha
// visto (profiles.novedad_vista, migración 0059). Va dentro del Layout, ya
// con el perfil completo y las áreas cargadas.
export function AvisoNovedades() {
  const { profile, refrescarPerfil } = useAuth()
  const contexto = useContextoNovedades()
  const [cerrada, setCerrada] = useState(false)

  const pendientes = profile
    ? novedadesPendientes(contexto, profile.novedad_vista, profile.created_at)
    : []

  if (!profile || cerrada || pendientes.length === 0) return null

  async function cerrar() {
    setCerrada(true)
    if (!profile) return
    const { error } = await supabase
      .from('profiles')
      .update({ novedad_vista: NOVEDADES[0].id })
      .eq('id', profile.id)
    // Si falla, se vuelve a mostrar en la próxima sesión; no es grave.
    if (error) console.error('No se pudo marcar la novedad como vista:', error.message)
    else await refrescarPerfil()
  }

  return <NovedadesModal novedades={pendientes} onCerrar={cerrar} />
}
