import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface SerieLinea {
  clave: string
  nombre: string
  color: string
  // Línea punteada, p. ej. para lo presupuestado frente a lo real.
  punteada?: boolean
}

// Por defecto: solicitudes creadas y resueltas (serieTemporal).
const SERIES_SOLICITUDES: SerieLinea[] = [
  { clave: 'creados', nombre: 'Creados', color: 'var(--series-1)' },
  { clave: 'resueltos', nombre: 'Resueltos', color: 'var(--estado-finalizado)' },
]

interface LineaTendenciaProps {
  // Cada punto trae "periodo" y un número por cada clave de las series.
  datos: { periodo: string }[]
  formatearEtiqueta: (periodo: string) => string
  series?: SerieLinea[]
  // Para horas: eje con decimales y valores con unidad en el tooltip.
  unidad?: string
}

export function LineaTendencia({ datos, formatearEtiqueta, series = SERIES_SOLICITUDES, unidad }: LineaTendenciaProps) {
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
          allowDecimals={!!unidad}
          tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
          axisLine={{ stroke: 'var(--baseline)' }}
          tickLine={false}
          width={unidad ? 40 : 32}
        />
        <Tooltip
          labelFormatter={(periodo) => formatearEtiqueta(String(periodo))}
          formatter={unidad ? (valor) => `${Math.round(Number(valor) * 10) / 10} ${unidad}` : undefined}
          contentStyle={{
            background: 'var(--surface-1)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 13,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((serie) => (
          <Line
            key={serie.clave}
            type="monotone"
            dataKey={serie.clave}
            name={serie.nombre}
            stroke={serie.color}
            strokeWidth={2}
            strokeDasharray={serie.punteada ? '5 4' : undefined}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
