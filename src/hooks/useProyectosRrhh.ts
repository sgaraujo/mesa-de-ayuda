import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface ProyectoRrhh {
  proyecto: string
  es_mio: boolean
}

// Proyectos vigentes de la base de RRHH (Nelyoda, migración 0053). Solo se
// piden cuando hacen falta (activo = el área elegida pide proyecto).
export function useProyectosRrhh(activo: boolean) {
  const [proyectos, setProyectos] = useState<ProyectoRrhh[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!activo) return
    let cancelado = false
    setLoading(true)
    void supabase.rpc('proyectos_rrhh').then(({ data }) => {
      if (cancelado) return
      setProyectos((data ?? []) as ProyectoRrhh[])
      setLoading(false)
    })
    return () => {
      cancelado = true
    }
  }, [activo])

  return { proyectos, loading }
}
