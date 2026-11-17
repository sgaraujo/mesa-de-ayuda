import { useEffect, useRef } from 'react'
import type { Novedad } from '../lib/novedades'

interface NovedadesModalProps {
  novedades: Novedad[]
  onCerrar: () => void
}

const formatoFecha = new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: 'UTC' })

export function NovedadesModal({ novedades, onCerrar }: NovedadesModalProps) {
  const botonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    botonRef.current?.focus()
    function cerrarConEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCerrar()
    }
    document.addEventListener('keydown', cerrarConEscape)
    return () => document.removeEventListener('keydown', cerrarConEscape)
  }, [onCerrar])

  if (novedades.length === 0) return null

  return (
    <div className="modal-overlay modal-overlay--confirmacion" onMouseDown={onCerrar}>
      <div
        className="novedades"
        role="dialog"
        aria-modal="true"
        aria-labelledby="novedades-titulo"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="novedades__encabezado">
          <span className="novedades__etiqueta">Novedades</span>
          <h2 id="novedades-titulo">{novedades[0].titulo}</h2>
        </div>

        <div className="novedades__cuerpo">
          {novedades.map((novedad, i) => (
            <section key={novedad.id} className="novedades__grupo">
              {(i > 0 || novedades.length > 1) && (
                <h3 className="novedades__fecha">
                  {i > 0 && <span>{novedad.titulo} · </span>}
                  {formatoFecha.format(new Date(`${novedad.fecha}T00:00:00Z`))}
                </h3>
              )}
              <ul className="novedades__lista">
                {novedad.puntos.map((punto) => (
                  <li key={punto.titulo}>
                    <strong>{punto.titulo}</strong>
                    <p>{punto.texto}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="novedades__acciones">
          <button ref={botonRef} type="button" onClick={onCerrar}>
            Entendido
          </button>
        </div>
      </div>
    </div>
  )
}
