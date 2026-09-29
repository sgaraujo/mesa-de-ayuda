import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type { Area, RolArea } from '../types/database'

export interface AreaConRol extends Area {
  rol: RolArea
}

interface AreaContextValue {
  areas: AreaConRol[]
  areaActiva: AreaConRol | null
  seleccionarArea: (areaId: string) => void
  esSuperadmin: boolean
  loading: boolean
  recargar: () => Promise<void>
}

const AREA_ACTIVA_KEY = 'area-activa'

function leerAreaGuardada(): string | null {
  try {
    return localStorage.getItem(AREA_ACTIVA_KEY)
  } catch {
    return null
  }
}

function guardarArea(areaId: string) {
  try {
    localStorage.setItem(AREA_ACTIVA_KEY, areaId)
  } catch {
    // Sin almacenamiento disponible solo se pierde la preferencia entre visitas.
  }
}

const AreaContext = createContext<AreaContextValue | undefined>(undefined)

// Cada área es un tablero cerrado; el rol de la persona depende del área que
// tenga abierta (area_miembros). El superadmin (profiles.role = 'admin') puede
// abrir cualquier área y actúa como admin en todas.
export function AreaProvider({ children }: { children: ReactNode }) {
  const { profile, loading: cargandoPerfil } = useAuth()
  const [areas, setAreas] = useState<AreaConRol[]>([])
  const [areaActivaId, setAreaActivaId] = useState<string | null>(leerAreaGuardada)
  const [loading, setLoading] = useState(true)

  const esSuperadmin = profile?.role === 'admin' && profile.activo
  const profileId = profile?.id

  const recargar = useCallback(async () => {
    if (!profileId) {
      setAreas([])
      setLoading(false)
      return
    }

    const { data: membresias } = await supabase
      .from('area_miembros')
      .select('rol, area:areas(id, nombre, orden)')
      .eq('profile_id', profileId)

    const propias = ((membresias ?? []) as unknown as { rol: RolArea; area: Area | null }[])
      .filter((m) => m.area)
      .map((m) => ({ ...m.area!, rol: m.rol }))

    if (esSuperadmin) {
      const { data: todas } = await supabase.from('areas').select('*').order('orden')
      setAreas(((todas ?? []) as Area[]).map((area) => ({ ...area, rol: 'admin' as const })))
    } else {
      setAreas(propias.sort((a, b) => a.orden - b.orden))
    }
    setLoading(false)
  }, [profileId, esSuperadmin])

  useEffect(() => {
    if (cargandoPerfil) return
    setLoading(true)
    void recargar()
  }, [cargandoPerfil, recargar])

  const areaActiva = areas.find((a) => a.id === areaActivaId) ?? areas[0] ?? null

  function seleccionarArea(areaId: string) {
    setAreaActivaId(areaId)
    guardarArea(areaId)
  }

  return (
    <AreaContext.Provider value={{ areas, areaActiva, seleccionarArea, esSuperadmin, loading, recargar }}>
      {children}
    </AreaContext.Provider>
  )
}

export function useArea() {
  const ctx = useContext(AreaContext)
  if (!ctx) throw new Error('useArea debe usarse dentro de <AreaProvider>')
  return ctx
}
