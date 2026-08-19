import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Area } from '../types/database'

export function useAreas() {
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(true)

  const recargar = useCallback(() => {
    return supabase
      .from('areas')
      .select('*')
      .order('orden')
      .then(({ data }) => {
        setAreas(data ?? [])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    recargar()
  }, [recargar])

  return { areas, loading, recargar }
}
