import type { ConteoCategoria } from '../lib/agregaciones'

const PALETA_CATEGORICA = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
]

interface RankingListaProps {
  datos: ConteoCategoria[]
  color?: (nombre: string, indice: number) => string
}

export function RankingLista({ datos, color }: RankingListaProps) {
  if (datos.length === 0) {
    return <p className="chart-card__vacio">Sin datos todavía</p>
  }

  const total = datos.reduce((acc, d) => acc + d.total, 0)
  const max = Math.max(...datos.map((d) => d.total))

  return (
    <ol className="ranking-lista">
      {datos.map((d, i) => {
        const porcentaje = total > 0 ? (d.total / total) * 100 : 0
        const anchoBarra = max > 0 ? (d.total / max) * 100 : 0
        const colorBarra = color ? color(d.nombre, i) : PALETA_CATEGORICA[i % PALETA_CATEGORICA.length]
        return (
          <li key={d.nombre} className="ranking-item">
            <span className="ranking-item__rank">#{i + 1}</span>
            <div className="ranking-item__cuerpo">
              <div className="ranking-item__cabecera">
                <span className="ranking-item__nombre">{d.nombre}</span>
                <span className="ranking-item__valor">
                  {d.total} · {porcentaje.toFixed(1)}%
                </span>
              </div>
              <div className="ranking-item__barra-fondo">
                <div
                  className="ranking-item__barra"
                  style={{ width: `${anchoBarra}%`, background: colorBarra }}
                />
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
