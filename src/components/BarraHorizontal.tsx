import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ConteoCategoria } from '../lib/agregaciones'

export function BarraHorizontal({ datos }: { datos: ConteoCategoria[] }) {
  if (datos.length === 0) {
    return <p className="chart-card__vacio">Sin datos todavía</p>
  }

  const alto = Math.max(120, datos.length * 44)

  return (
    <ResponsiveContainer width="100%" height={alto}>
      <BarChart data={datos} layout="vertical" margin={{ left: 8, right: 24 }}>
        <CartesianGrid horizontal={false} stroke="var(--gridline)" strokeDasharray="0" />
        <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={{ stroke: 'var(--baseline)' }} tickLine={false} />
        <YAxis
          type="category"
          dataKey="nombre"
          width={120}
          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
          axisLine={{ stroke: 'var(--baseline)' }}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: 'var(--gridline)', opacity: 0.4 }}
          contentStyle={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 13,
          }}
        />
        <Bar dataKey="total" fill="var(--series-1)" barSize={20} radius={[0, 4, 4, 0]}>
          <LabelList dataKey="total" position="right" fill="var(--text-secondary)" fontSize={12} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
