import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'

export type UsuarioActivo = Pick<Profile, 'id' | 'full_name' | 'email'>

// Todas las personas activas de la Mesa de Ayuda, de cualquier área (para
// mencionarlas con @ en los comentarios).
export function useUsuariosActivos() {
  const [usuarios, setUsuarios] = useState<UsuarioActivo[]>([])

  useEffect(() => {
    let cancelado = false
    void supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('activo', true)
      .order('full_name')
      .then(({ data }) => {
        if (!cancelado) setUsuarios((data as UsuarioActivo[]) ?? [])
      })
    return () => {
      cancelado = true
    }
  }, [])

  return usuarios
}
