export function separarTiempo(horas: number | null): [string, string] {
  if (horas == null) return ['', '']
  const minutosTotales = Math.round(horas * 60)
  return [String(Math.floor(minutosTotales / 60)), String(minutosTotales % 60)]
}

export function combinarTiempo(horas: string, minutos: string): number | null {
  if (!horas && !minutos) return null
  return (Number(horas || 0) * 60 + Number(minutos || 0)) / 60
}

export function formatearTiempo(horas: number | null): string {
  if (horas == null) return 'Sin definir'
  const minutosTotales = Math.round(horas * 60)
  const horasEnteras = Math.floor(minutosTotales / 60)
  const minutos = minutosTotales % 60
  return [horasEnteras ? `${horasEnteras} h` : '', minutos ? `${minutos} min` : ''].filter(Boolean).join(' ') || '0 min'
}
