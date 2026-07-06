import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'

export function useAgentes() {
  const [agentes, setAgentes] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .in('role', ['agente', 'admin'])
      .order('full_name')
      .then(({ data }) => {
        setAgentes(data ?? [])
        setLoading(false)
      })
  }, [])

  return { agentes, loading }
}
