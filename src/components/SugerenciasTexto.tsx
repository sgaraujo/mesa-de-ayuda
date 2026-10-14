import { useRevisionTexto, type SugerenciaTexto } from '../hooks/useRevisionTexto'

const TIPO_LABEL: Record<SugerenciaTexto['tipo'], string> = {
  ortografia: 'Ortografía',
  gramatica: 'Gramática',
  estilo: 'Estilo',
}

const CONTEXTO_CARACTERES = 28

interface SugerenciasTextoProps {
  texto: string
  onCambiar: (texto: string) => void
  // Fragmentos que no se corrigen, p. ej. los "@Nombre" de las menciones:
  // cambiarlos rompería la mención y la persona no recibiría el aviso.
  protegidos?: string[]
}

function rangosProtegidos(texto: string, protegidos: string[]): [number, number][] {
  const rangos: [number, number][] = []
  for (const fragmento of protegidos) {
    if (!fragmento) continue
    for (let i = texto.indexOf(fragmento); i !== -1; i = texto.indexOf(fragmento, i + 1)) {
      rangos.push([i, i + fragmento.length])
    }
  }
  return rangos
}

// Panel bajo un campo de texto con los errores ortográficos y gramaticales
// detectados y sus correcciones, al estilo del revisor de Word.
export function SugerenciasTexto({ texto, onCambiar, protegidos = [] }: SugerenciasTextoProps) {
  const revision = useRevisionTexto(texto)
  const { revisando, revisado, noDisponible, aplicar, ignorar } = revision
  const rangos = rangosProtegidos(texto, protegidos)
  const sugerencias = revision.sugerencias.filter(
    (s) => !rangos.some(([inicio, fin]) => s.inicio < fin && s.inicio + s.largo > inicio),
  )

  if (noDisponible && sugerencias.length === 0) {
    return <p className="revision-texto__estado">La revisión ortográfica no está disponible en este momento.</p>
  }
  if (sugerencias.length === 0) {
    if (revisando) return <p className="revision-texto__estado">Revisando ortografía y gramática…</p>
    if (revisado) return <p className="revision-texto__estado revision-texto__estado--ok">✓ Sin errores detectados</p>
    return null
  }

  return (
    <div className="revision-texto" aria-live="polite">
      <p className="revision-texto__titulo">
        {sugerencias.length} {sugerencias.length === 1 ? 'sugerencia' : 'sugerencias'}
        {revisando && <span> · revisando…</span>}
      </p>
      <ul className="revision-texto__lista">
        {sugerencias.map((s) => {
          const antes = texto.slice(Math.max(0, s.inicio - CONTEXTO_CARACTERES), s.inicio)
          const despues = texto.slice(s.inicio + s.largo, s.inicio + s.largo + CONTEXTO_CARACTERES)
          return (
            <li key={`${s.inicio}-${s.regla}`} className={`revision-texto__item revision-texto__item--${s.tipo}`}>
              <span className="revision-texto__tipo">{TIPO_LABEL[s.tipo]}</span>
              <p className="revision-texto__contexto">
                {s.inicio > CONTEXTO_CARACTERES && '…'}
                {antes}
                <mark>{s.fragmento}</mark>
                {despues}
                {s.inicio + s.largo + CONTEXTO_CARACTERES < texto.length && '…'}
              </p>
              <p className="revision-texto__mensaje">{s.mensaje}</p>
              <div className="revision-texto__acciones">
                {s.reemplazos.map((reemplazo) => (
                  <button
                    key={reemplazo}
                    type="button"
                    className="revision-texto__reemplazo"
                    onClick={() => onCambiar(aplicar(s, reemplazo))}
                  >
                    {reemplazo || '(quitar)'}
                  </button>
                ))}
                <button type="button" className="revision-texto__ignorar" onClick={() => ignorar(s)}>
                  Ignorar
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
