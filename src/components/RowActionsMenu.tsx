import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface RowActionsMenuProps {
  children: ReactNode
}

const SEPARACION_PX = 6
const MARGEN_VENTANA_PX = 8

// Menú "⋯" de acciones por fila. La lista se dibuja en un portal con
// position: fixed junto al botón: dentro de la tabla (que tiene scroll
// propio) quedaba recortada. Abre hacia abajo, o hacia arriba si no cabe, y
// se cierra al hacer scroll o cambiar el tamaño de la ventana.
export function RowActionsMenu({ children }: RowActionsMenuProps) {
  const [abierto, setAbierto] = useState(false)
  const [posicion, setPosicion] = useState<CSSProperties>({ visibility: 'hidden' })
  const disparadorRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!abierto || !disparadorRef.current || !menuRef.current) return
    const boton = disparadorRef.current.getBoundingClientRect()
    const alto = menuRef.current.offsetHeight
    const cabeAbajo = boton.bottom + SEPARACION_PX + alto <= window.innerHeight - MARGEN_VENTANA_PX
    setPosicion({
      right: Math.max(MARGEN_VENTANA_PX, window.innerWidth - boton.right),
      ...(cabeAbajo || boton.top < alto
        ? { top: boton.bottom + SEPARACION_PX }
        : { bottom: window.innerHeight - boton.top + SEPARACION_PX }),
    })
    menuRef.current.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [abierto])

  useEffect(() => {
    if (!abierto) return

    function cerrar() {
      setAbierto(false)
      setPosicion({ visibility: 'hidden' })
    }
    function cerrarSiEsFuera(event: MouseEvent) {
      const objetivo = event.target as Node
      if (!disparadorRef.current?.contains(objetivo) && !menuRef.current?.contains(objetivo)) cerrar()
    }
    function cerrarConEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return
      cerrar()
      disparadorRef.current?.focus()
    }
    // Scroll dentro del propio menú no lo cierra; cualquier otro sí.
    function cerrarAlDesplazar(event: Event) {
      if (!menuRef.current?.contains(event.target as Node)) cerrar()
    }

    document.addEventListener('mousedown', cerrarSiEsFuera)
    document.addEventListener('keydown', cerrarConEscape)
    window.addEventListener('scroll', cerrarAlDesplazar, true)
    window.addEventListener('resize', cerrar)
    return () => {
      document.removeEventListener('mousedown', cerrarSiEsFuera)
      document.removeEventListener('keydown', cerrarConEscape)
      window.removeEventListener('scroll', cerrarAlDesplazar, true)
      window.removeEventListener('resize', cerrar)
    }
  }, [abierto])

  function moverFoco(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])
    if (items.length === 0) return
    const actual = items.indexOf(document.activeElement as HTMLElement)
    const paso = event.key === 'ArrowDown' ? 1 : -1
    items[(actual + paso + items.length) % items.length].focus()
  }

  function alternar() {
    setPosicion({ visibility: 'hidden' })
    setAbierto((actual) => !actual)
  }

  return (
    <div className="row-menu">
      <button
        ref={disparadorRef}
        type="button"
        className="row-menu__disparador"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label="Más acciones"
        onClick={alternar}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {abierto && createPortal(
        <div
          ref={menuRef}
          className="row-menu__lista"
          role="menu"
          style={posicion}
          onKeyDown={moverFoco}
          onClick={() => setAbierto(false)}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  )
}
