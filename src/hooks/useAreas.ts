import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Area } from '../types/database'

export function useAreas() {
  const [areas, setAreas] = useState<Area[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('areas')
      .select('*')
      .order('orden')
      .then(({ data }) => {
        setAreas(data ?? [])
        setLoading(false)
      })
  }, [])

  return { areas, loading }
}
