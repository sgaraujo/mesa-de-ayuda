export interface ConteoCategoria {
  nombre: string
  total: number
}

export function contarPor<T>(items: T[], obtenerClave: (item: T) => string | null): ConteoCategoria[] {
  const conteo = new Map<string, number>()
  for (const item of items) {
    const clave = obtenerClave(item) ?? 'Sin definir'
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1)
  }
  return Array.from(conteo.entries())
    .map(([nombre, total]) => ({ nombre, total }))
    .sort((a, b) => b.total - a.total)
}

export function formatearDuracion(horas: number): string {
  if (horas < 1) return `${Math.round(horas * 60)} min`
  if (horas < 24) return `${horas.toFixed(1)} h`
  return `${(horas / 24).toFixed(1)} d`
}

export type RangoFecha = 'todo' | '7d' | '30d' | 'mes_actual' | 'mes_anterior'

export function dentroDeRango(fechaIso: string, rango: RangoFecha): boolean {
  if (rango === 'todo') return true
  const fecha = new Date(fechaIso)
  const ahora = new Date()
  if (rango === '7d') return ahora.getTime() - fecha.getTime() <= 7 * 24 * 60 * 60 * 1000
  if (rango === '30d') return ahora.getTime() - fecha.getTime() <= 30 * 24 * 60 * 60 * 1000
  if (rango === 'mes_actual') {
    return fecha.getFullYear() === ahora.getFullYear() && fecha.getMonth() === ahora.getMonth()
  }
  const mesAnterior = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1)
  return fecha.getFullYear() === mesAnterior.getFullYear() && fecha.getMonth() === mesAnterior.getMonth()
}
