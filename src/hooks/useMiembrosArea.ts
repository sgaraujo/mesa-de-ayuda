import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile, RolArea } from '../types/database'

export interface MiembroArea {
  rol: RolArea
  profile: Profile
}

export function useMiembrosArea(areaId: string | undefined) {
  const [miembros, setMiembros] = useState<MiembroArea[]>([])
  const [loading, setLoading] = useState(true)

  const recargar = useCallback(async () => {
    if (!areaId) {
      setMiembros([])
      setLoading(false)
      return
    }
    const { data } = await supabase
      .from('area_miembros')
      .select('rol, profile:profiles(*)')
      .eq('area_id', areaId)
    const filas = ((data ?? []) as unknown as { rol: RolArea; profile: Profile | null }[])
      .filter((m): m is MiembroArea => m.profile !== null)
      .sort((a, b) => (a.profile.full_name ?? a.profile.email).localeCompare(b.profile.full_name ?? b.profile.email))
    setMiembros(filas)
    setLoading(false)
  }, [areaId])

  useEffect(() => {
    void recargar()
  }, [recargar])

  // Quienes pueden recibir tareas en el área: agentes y líderes activos
  // (todos los miembros tienen uno de esos dos roles).
  const agentes = miembros
    .filter((m) => m.profile.activo)
    .map((m) => ({ ...m.profile, rolArea: m.rol }))

  return { miembros, agentes, loading, recargar }
}
