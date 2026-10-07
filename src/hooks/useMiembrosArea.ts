import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile, RolArea } from '../types/database'

export interface MiembroArea {
  rol: RolArea
  profile: Profile
}

// Con todasLasAreas (tablero general del superadmin) trae los miembros de
// todas las áreas, una sola vez por persona aunque esté en varias.
export function useMiembrosArea(areaId: string | undefined, todasLasAreas = false) {
  const [miembros, setMiembros] = useState<MiembroArea[]>([])
  const [loading, setLoading] = useState(true)

  const recargar = useCallback(async () => {
    if (!areaId && !todasLasAreas) {
      setMiembros([])
      setLoading(false)
      return
    }
    let consulta = supabase.from('area_miembros').select('rol, profile:profiles(*)')
    if (!todasLasAreas) consulta = consulta.eq('area_id', areaId!)
    const { data } = await consulta
    const porPersona = new Map<string, MiembroArea>()
    for (const m of (data ?? []) as unknown as { rol: RolArea; profile: Profile | null }[]) {
      if (!m.profile) continue
      const previo = porPersona.get(m.profile.id)
      if (!previo || m.rol === 'lider') porPersona.set(m.profile.id, m as MiembroArea)
    }
    const filas = Array.from(porPersona.values())
      .sort((a, b) => (a.profile.full_name ?? a.profile.email).localeCompare(b.profile.full_name ?? b.profile.email))
    setMiembros(filas)
    setLoading(false)
  }, [areaId, todasLasAreas])

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
