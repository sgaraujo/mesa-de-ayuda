import { useCallback, useState } from 'react'

// Estado que se recuerda entre visitas en este navegador (localStorage), para
// que un filtro quede como la persona lo dejó. Es solo una comodidad: si el
// almacenamiento no está disponible (navegación privada, bloqueado), funciona
// como un useState normal.
function leer<T>(clave: string, inicial: T): T {
  try {
    const guardado = localStorage.getItem(clave)
    return guardado === null ? inicial : (JSON.parse(guardado) as T)
  } catch {
    return inicial
  }
}

export function useEstadoGuardado<T>(clave: string, inicial: T): [T, (valor: T) => void] {
  const [valor, setValor] = useState<T>(() => leer(clave, inicial))

  const guardar = useCallback(
    (nuevo: T) => {
      setValor(nuevo)
      try {
        localStorage.setItem(clave, JSON.stringify(nuevo))
      } catch {
        // Sin almacenamiento solo se pierde el recuerdo entre visitas.
      }
    },
    [clave],
  )

  return [valor, guardar]
}
