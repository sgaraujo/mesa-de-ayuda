import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
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

interface DonutChartProps {
  datos: ConteoCategoria[]
  centroEtiqueta?: string
}

export function DonutChart({ datos, centroEtiqueta = 'Total' }: DonutChartProps) {
  if (datos.length === 0) {
    return <p className="chart-card__vacio">Sin datos todavía</p>
  }

  const total = datos.reduce((acc, d) => acc + d.total, 0)

  return (
    <div className="donut-chart">
      <div className="donut-chart__grafico">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={datos}
              dataKey="total"
              nameKey="nombre"
              innerRadius={58}
              outerRadius={88}
              paddingAngle={2}
              strokeWidth={0}
            >
              {datos.map((d, i) => (
                <Cell key={d.nombre} fill={PALETA_CATEGORICA[i % PALETA_CATEGORICA.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, nombre) => {
                const numero = Number(value ?? 0)
                const porcentaje = total > 0 ? ((numero / total) * 100).toFixed(1) : '0'
                return [`${numero} · ${porcentaje}%`, nombre ?? '']
              }}
              contentStyle={{
                background: 'var(--surface-1)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 13,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-chart__centro">
          <span className="donut-chart__total">{total}</span>
          <span className="donut-chart__etiqueta">{centroEtiqueta}</span>
        </div>
      </div>
      <ul className="donut-chart__leyenda">
        {datos.map((d, i) => (
          <li key={d.nombre}>
            <span
              className="donut-chart__punto"
              style={{ background: PALETA_CATEGORICA[i % PALETA_CATEGORICA.length] }}
            />
            <span className="donut-chart__leyenda-nombre">{d.nombre}</span>
            <strong>{total > 0 ? ((d.total / total) * 100).toFixed(0) : 0}%</strong>
          </li>
        ))}
      </ul>
    </div>
  )
}
