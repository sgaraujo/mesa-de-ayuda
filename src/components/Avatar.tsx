// Círculo con las iniciales de una persona; el color sale del nombre para que
// cada quien tenga siempre el mismo.
const COLORES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8']

function iniciales(nombre: string): string {
  const partes = nombre.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return ((partes[0]?.[0] ?? '?') + (partes[1]?.[0] ?? '')).toUpperCase()
}

function colorPara(nombre: string): string {
  let hash = 0
  for (const caracter of nombre) hash = (hash * 31 + caracter.charCodeAt(0)) | 0
  return `var(${COLORES[Math.abs(hash) % COLORES.length]})`
}

interface AvatarProps {
  nombre: string
  tamano?: 'sm' | 'md'
}

export function Avatar({ nombre, tamano = 'md' }: AvatarProps) {
  return (
    <span
      className={`avatar avatar--${tamano}`}
      style={{ background: colorPara(nombre) }}
      title={nombre}
      aria-hidden="true"
    >
      {iniciales(nombre)}
    </span>
  )
}
