import { useEffect, useRef, useState, type ReactNode } from 'react'

interface RowActionsMenuProps {
  children: ReactNode
}

export function RowActionsMenu({ children }: RowActionsMenuProps) {
  const [abierto, setAbierto] = useState(false)
  const contenedorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return

    function cerrarSiEsFuera(event: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(event.target as Node)) setAbierto(false)
    }
    function cerrarConEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setAbierto(false)
    }

    document.addEventListener('mousedown', cerrarSiEsFuera)
    document.addEventListener('keydown', cerrarConEscape)
    return () => {
      document.removeEventListener('mousedown', cerrarSiEsFuera)
      document.removeEventListener('keydown', cerrarConEscape)
    }
  }, [abierto])

  return (
    <div className="row-menu" ref={contenedorRef}>
      <button
        type="button"
        className="row-menu__disparador"
        aria-haspopup="true"
        aria-expanded={abierto}
        aria-label="Más acciones"
        onClick={() => setAbierto((actual) => !actual)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {abierto && (
        <div className="row-menu__lista" role="menu" onClick={() => setAbierto(false)}>
          {children}
        </div>
      )}
    </div>
  )
}
