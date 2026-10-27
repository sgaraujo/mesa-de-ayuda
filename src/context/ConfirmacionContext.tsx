import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ConfirmDialog } from '../components/ConfirmDialog'

export interface OpcionesConfirmacion {
  titulo: string
  descripcion: string
  textoConfirmar?: string
  tono?: 'peligro' | 'normal'
}

type Confirmar = (opciones: OpcionesConfirmacion) => Promise<boolean>

const ConfirmacionContext = createContext<Confirmar | null>(null)

// Reemplazo de window.confirm() con el diálogo de la plataforma:
// `if (!(await confirmar({ titulo, descripcion }))) return`.
export function ConfirmacionProvider({ children }: { children: ReactNode }) {
  const [opciones, setOpciones] = useState<OpcionesConfirmacion | null>(null)
  const resolverRef = useRef<((respuesta: boolean) => void) | null>(null)

  const confirmar = useCallback<Confirmar>((nuevas) => {
    // Si había otra pregunta abierta, se toma como cancelada.
    resolverRef.current?.(false)
    setOpciones(nuevas)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const responder = useCallback((respuesta: boolean) => {
    resolverRef.current?.(respuesta)
    resolverRef.current = null
    setOpciones(null)
  }, [])

  const cancelar = useCallback(() => responder(false), [responder])

  return (
    <ConfirmacionContext.Provider value={confirmar}>
      {children}
      {/* En body, después de los modales que también se montan ahí. */}
      {opciones && createPortal(
        <ConfirmDialog
          abierto
          titulo={opciones.titulo}
          descripcion={opciones.descripcion}
          textoConfirmar={opciones.textoConfirmar}
          tono={opciones.tono}
          onConfirmar={() => responder(true)}
          onCancelar={cancelar}
        />,
        document.body,
      )}
    </ConfirmacionContext.Provider>
  )
}

export function useConfirmar(): Confirmar {
  const confirmar = useContext(ConfirmacionContext)
  if (!confirmar) throw new Error('useConfirmar debe usarse dentro de ConfirmacionProvider')
  return confirmar
}
