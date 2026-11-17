import { supabase } from './supabase'
import { dentroDeRango, limitesDeRango, type RangoFecha, type RangoPersonalizado } from './agregaciones'
import type { TicketConRelaciones } from '../types/database'

// Máximo de filas que PostgREST devuelve por consulta.
export const PAGINA = 1000

/**
 * Trae todas las filas de una consulta por páginas: PostgREST corta en 1000
 * sin avisar y las cifras quedaban incompletas en áreas grandes. La consulta
 * debe tener un orden estable.
 */
export async function cargarPaginado<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const filas: T[] = []
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await pagina(desde, desde + PAGINA - 1)
    if (error) throw new Error(error.message)
    filas.push(...(data ?? []))
    if (!data || data.length < PAGINA) return filas
  }
}

/** Movimiento de una tarea en un día del periodo (actividad_tickets, migración 0060). */
export interface FilaActividad {
  ticket_id: string
  /** AAAA-MM-DD, hora de Colombia. */
  dia: string
  /** Horas ejecutadas ese día (diferencia; puede ser negativa si se corrigió). */
  horas: number
  /** Hubo un cambio, un cambio de estado o un comentario ese día. */
  actividad: boolean
}

/**
 * Actividad y horas del periodo según el historial. `exacta` es false si la
 * base todavía no tiene la migración 0060: entonces se aproxima con lo que
 * tiene cada tarea (actividadAproximada).
 */
export async function cargarActividad(
  idsAreas: string[],
  rango: RangoFecha,
  personalizado: RangoPersonalizado,
): Promise<{ filas: FilaActividad[]; exacta: boolean }> {
  const { desde, hasta } = limitesDeRango(rango, personalizado)
  try {
    const filas = await cargarPaginado<FilaActividad>((inicio, fin) =>
      supabase
        .rpc('actividad_tickets', {
          p_areas: idsAreas,
          p_desde: desde?.toISOString() ?? null,
          p_hasta: hasta?.toISOString() ?? null,
        })
        .range(inicio, fin),
    )
    return { filas: filas.map((f) => ({ ...f, horas: Number(f.horas) || 0 })), exacta: true }
  } catch (error) {
    console.error('No se pudo cargar la actividad del periodo:', (error as Error).message)
    return { filas: [], exacta: false }
  }
}

const diaDe = (iso: string) => {
  const f = new Date(iso)
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`
}

/**
 * Sin historial: la tarea cuenta como actualizada en su última modificación
 * y sus horas caen el día en que se finalizó (o se creó, si sigue abierta).
 */
export function actividadAproximada(
  tickets: TicketConRelaciones[],
  rango: RangoFecha,
  personalizado: RangoPersonalizado,
): FilaActividad[] {
  const filas: FilaActividad[] = []
  for (const t of tickets) {
    if (t.updated_at && dentroDeRango(t.updated_at, rango, personalizado)) {
      filas.push({ ticket_id: t.id, dia: diaDe(t.updated_at), horas: 0, actividad: true })
    }
    const fechaHoras = t.finalizado_at ?? t.created_at
    if (t.tiempo_ejecutado_horas && dentroDeRango(fechaHoras, rango, personalizado)) {
      filas.push({ ticket_id: t.id, dia: diaDe(fechaHoras), horas: t.tiempo_ejecutado_horas, actividad: false })
    }
  }
  return filas
}
