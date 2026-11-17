import { useArea } from '../context/AreaContext'
import type { ContextoNovedades } from '../lib/novedades'

/** Quién es la persona, para filtrar los puntos de cada novedad. */
export function useContextoNovedades(): ContextoNovedades {
  const { areas, esSuperadmin } = useArea()
  const esLider = esSuperadmin || areas.some((a) => a.rol === 'lider')
  return { esLider, esEquipo: esLider || areas.some((a) => a.rol === 'agente') }
}
