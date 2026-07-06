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
