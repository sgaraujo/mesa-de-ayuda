import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Proyecto } from '../types/database'

// Cada área tiene sus propios proyectos; las demás no los ven.
export function useProyectos(areaId: string | undefined) {
  const [proyectos, setProyectos] = useState<Proyecto[]>([])
  const [loading, setLoading] = useState(true)

  const recargar = useCallback(async () => {
    if (!areaId) {
      setProyectos([])
      setLoading(false)
      return
    }
    const { data } = await supabase
      .from('proyectos')
      .select('*')
      .eq('area_id', areaId)
      .order('nombre')
    setProyectos(data ?? [])
    setLoading(false)
  }, [areaId])

  useEffect(() => {
    void recargar()
  }, [recargar])

  return { proyectos, loading, recargar }
}
