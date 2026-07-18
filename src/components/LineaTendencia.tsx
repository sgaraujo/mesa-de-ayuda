import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PuntoSerieTemporal } from '../lib/agregaciones'

interface LineaTendenciaProps {
  datos: PuntoSerieTemporal[]
  formatearEtiqueta: (periodo: string) => string
}

export function LineaTendencia({ datos, formatearEtiqueta }: LineaTendenciaProps) {
  if (datos.length === 0) {
    return <p className="chart-card__vacio">Sin datos todavía</p>
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={datos} margin={{ left: 8, right: 16, top: 8 }}>
        <CartesianGrid stroke="var(--gridline)" strokeDasharray="0" vertical={false} />
        <XAxis
          dataKey="periodo"
          tickFormatter={formatearEtiqueta}
          tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
          axisLine={{ stroke: 'var(--baseline)' }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
          axisLine={{ stroke: 'var(--baseline)' }}
          tickLine={false}
          width={32}
        />
        <Tooltip
          labelFormatter={(periodo) => formatearEtiqueta(String(periodo))}
          contentStyle={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 13,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="creados" name="Creados" stroke="var(--series-1)" strokeWidth={2} dot={false} />
        <Line
          type="monotone"
          dataKey="resueltos"
          name="Resueltos"
          stroke="var(--estado-finalizado)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
