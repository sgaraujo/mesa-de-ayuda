import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Proyecto } from '../types/database'

// Proyectos del área más los compartidos (sin área, creados antes de que
// cada área tuviera su propio tablero).
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
      .or(`area_id.eq.${areaId},area_id.is.null`)
      .order('nombre')
    setProyectos(data ?? [])
    setLoading(false)
  }, [areaId])

  useEffect(() => {
    void recargar()
  }, [recargar])

  return { proyectos, loading, recargar }
}
