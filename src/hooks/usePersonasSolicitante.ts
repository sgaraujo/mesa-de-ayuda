import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { PersonaOpcion } from '../components/SelectorPersona'
import type { RelacionLaboralNelyoda } from '../types/database'

// Prefijo del valor de quien está en Nelyoda pero no tiene cuenta: no tiene
// id de perfil, así que se identifica por su correo.
export const PREFIJO_SIN_CUENTA = 'nelyoda:'

// Correo interno de quien entra con cédula (supabase/functions/_shared/cedula.ts):
// no existe, no se muestra.
const DOMINIO_SIN_CORREO = '@cedula.local'
// Máximo de filas por consulta de PostgREST.
const PAGINA = 1000

type FilaNelyoda = { email: string; nombre: string | null; relaciones: RelacionLaboralNelyoda[] | null }
type FilaPerfil = { id: string; full_name: string | null; email: string; area_id: string | null }

async function cargarNelyoda(): Promise<FilaNelyoda[]> {
  const filas: FilaNelyoda[] = []
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase
      .from('personas_nelyoda')
      .select('email, nombre, relaciones')
      .eq('activo', true)
      .order('email')
      .range(desde, desde + PAGINA - 1)
    if (error) throw error
    filas.push(...((data ?? []) as FilaNelyoda[]))
    if (!data || data.length < PAGINA) return filas
  }
}

// Personas a las que el líder puede registrar como quien pidió una tarea
// (migración 0053): los empleados vigentes de Nelyoda más los usuarios
// activos de la Mesa de Ayuda que no están allá. Con cuenta, el valor es su
// id de perfil; sin cuenta, PREFIJO_SIN_CUENTA + correo.
export function usePersonasSolicitante(habilitado: boolean, excluirId?: string) {
  const [personas, setPersonas] = useState<PersonaOpcion[]>([])
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    if (!habilitado) return
    let cancelado = false
    setCargando(true)
    void Promise.all([
      // Si Nelyoda falla, al menos quedan los usuarios de la app.
      cargarNelyoda().catch(() => [] as FilaNelyoda[]),
      supabase.from('profiles').select('id, full_name, email, area_id').eq('activo', true),
    ]).then(([nelyoda, { data: perfiles }]) => {
      if (cancelado) return
      const perfilPorCorreo = new Map(((perfiles ?? []) as FilaPerfil[]).map((p) => [p.email.toLowerCase(), p]))
      const lista: PersonaOpcion[] = []
      const correosVistos = new Set<string>()

      for (const n of nelyoda) {
        const correo = n.email.toLowerCase()
        correosVistos.add(correo)
        const perfil = perfilPorCorreo.get(correo)
        const relacion = n.relaciones?.[0]
        const interno = correo.endsWith(DOMINIO_SIN_CORREO)
        lista.push({
          id: perfil?.id ?? `${PREFIJO_SIN_CUENTA}${correo}`,
          full_name: n.nombre ?? perfil?.full_name ?? null,
          email: interno ? '' : correo,
          grupo: relacion?.empresa ?? undefined,
          detalle: relacion?.cargo ?? (interno ? undefined : correo),
        })
      }
      for (const [correo, perfil] of perfilPorCorreo) {
        if (!correosVistos.has(correo)) lista.push(perfil)
      }

      setPersonas(lista.filter((p) => p.id !== excluirId && (p.full_name?.trim() || p.email)))
      setCargando(false)
    })
    return () => {
      cancelado = true
    }
  }, [habilitado, excluirId])

  return { personas, cargando }
}
