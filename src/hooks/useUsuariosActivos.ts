import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'

export type UsuarioActivo = Pick<Profile, 'id' | 'full_name' | 'email'>

type UsuarioConArea = UsuarioActivo & Pick<Profile, 'area_id'>

// Todas las personas activas de la Mesa de Ayuda, de cualquier área (para
// mencionarlas con @ en los comentarios y en los selectores de personas,
// que las agrupan por área).
export function useUsuariosActivos() {
  const [usuarios, setUsuarios] = useState<UsuarioConArea[]>([])

  useEffect(() => {
    let cancelado = false
    void supabase
      .from('profiles')
      .select('id, full_name, email, area_id')
      .eq('activo', true)
      .order('full_name')
      .then(({ data }) => {
        if (!cancelado) setUsuarios((data as UsuarioConArea[]) ?? [])
      })
    return () => {
      cancelado = true
    }
  }, [])

  return usuarios
}
