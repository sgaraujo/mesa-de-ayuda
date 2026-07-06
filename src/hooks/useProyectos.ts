import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Proyecto } from '../types/database'

export function useProyectos() {
  const [proyectos, setProyectos] = useState<Proyecto[]>([])
  const [loading, setLoading] = useState(true)

  const recargar = useCallback(() => {
    return supabase
      .from('proyectos')
      .select('*')
      .order('nombre')
      .then(({ data }) => {
        setProyectos(data ?? [])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    recargar()
  }, [recargar])

  return { proyectos, loading, recargar }
}
