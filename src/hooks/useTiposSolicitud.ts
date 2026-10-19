import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { TipoSolicitud } from '../types/database'

// Tipos activos del área; vacío si el área no tiene catálogo (no se pide tipo).
export function useTiposSolicitud(areaId: string | null | undefined) {
  const [tipos, setTipos] = useState<TipoSolicitud[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setTipos([])
    if (!areaId) return
    let vigente = true
    setLoading(true)
    void supabase
      .from('tipos_solicitud')
      .select('*')
      .eq('area_id', areaId)
      .eq('activo', true)
      .order('orden')
      .then(({ data }) => {
        if (!vigente) return
        setTipos(data ?? [])
        setLoading(false)
      })
    return () => {
      vigente = false
    }
  }, [areaId])

  return { tipos, loading }
}
