interface PantallaCargaProps {
  mensaje?: string
  /** Ocupa toda la ventana (antes de que exista el Layout). */
  completa?: boolean
}

// Mientras carga: un mini tablero donde una tarjeta pasa de Pendiente a En
// curso y a Finalizada, como en la mesa de ayuda. Solo CSS; con "reducir
// movimiento" la tarjeta se queda quieta.
export function PantallaCarga({ mensaje = 'Cargando...', completa = false }: PantallaCargaProps) {
  return (
    <div className={`pantalla-carga${completa ? ' pantalla-carga--completa' : ''}`} role="status" aria-live="polite">
      <div className="carga-tablero" aria-hidden="true">
        {(['pendiente', 'en-curso', 'finalizado'] as const).map((estado) => (
          <div key={estado} className={`carga-tablero__columna carga-tablero__columna--${estado}`}>
            <span className="carga-tablero__cabecera" />
            <span className="carga-tablero__tarjeta carga-tablero__tarjeta--fija" />
          </div>
        ))}
        <span className="carga-tablero__tarjeta carga-tablero__tarjeta--viajera">
          <span className="carga-tablero__linea" />
          <span className="carga-tablero__linea carga-tablero__linea--corta" />
        </span>
      </div>
      <p className="pantalla-carga__mensaje">{mensaje}</p>
    </div>
  )
}
