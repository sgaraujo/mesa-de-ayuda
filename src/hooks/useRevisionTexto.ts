import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface SugerenciaTexto {
  inicio: number
  largo: number
  fragmento: string
  mensaje: string
  reemplazos: string[]
  regla: string
  tipo: 'ortografia' | 'gramatica' | 'estilo'
}

// Espera tras la última tecla antes de revisar: la API gratuita de
// LanguageTool permite ~20 revisiones por minuto para toda la app.
const ESPERA_MS = 1500
const MIN_CARACTERES = 4

function claveIgnorada(s: SugerenciaTexto) {
  return `${s.regla}|${s.fragmento}`
}

export function useRevisionTexto(texto: string) {
  const [sugerencias, setSugerencias] = useState<SugerenciaTexto[]>([])
  const [ignoradas, setIgnoradas] = useState<Set<string>>(new Set())
  const [revisando, setRevisando] = useState(false)
  const [revisado, setRevisado] = useState(false)
  const [noDisponible, setNoDisponible] = useState(false)

  useEffect(() => {
    if (texto.trim().length < MIN_CARACTERES) {
      setSugerencias([])
      setRevisando(false)
      setRevisado(false)
      return
    }

    let cancelado = false
    const temporizador = setTimeout(async () => {
      setRevisando(true)
      const { data, error } = await supabase.functions.invoke('revisar-texto', { body: { texto } })
      if (cancelado) return
      setRevisando(false)
      if (error || !data?.ok) {
        setNoDisponible(true)
        return
      }
      setNoDisponible(false)
      setRevisado(true)
      setSugerencias(data.sugerencias as SugerenciaTexto[])
    }, ESPERA_MS)

    return () => {
      cancelado = true
      clearTimeout(temporizador)
    }
  }, [texto])

  // Mientras se sigue escribiendo, las posiciones de la última revisión pueden
  // quedar corridas: solo se muestran las que aún coinciden con el texto.
  const visibles = useMemo(
    () => sugerencias.filter(
      (s) => texto.slice(s.inicio, s.inicio + s.largo) === s.fragmento && !ignoradas.has(claveIgnorada(s)),
    ),
    [sugerencias, texto, ignoradas],
  )

  // Devuelve el texto con el reemplazo aplicado y corre las demás sugerencias
  // para que sigan apuntando a su fragmento sin esperar otra revisión.
  const aplicar = useCallback((sugerencia: SugerenciaTexto, reemplazo: string): string => {
    const fin = sugerencia.inicio + sugerencia.largo
    const delta = reemplazo.length - sugerencia.largo
    setSugerencias((prev) => prev
      .filter((s) => s !== sugerencia)
      .map((s) => (s.inicio >= fin ? { ...s, inicio: s.inicio + delta } : s)))
    return texto.slice(0, sugerencia.inicio) + reemplazo + texto.slice(fin)
  }, [texto])

  const ignorar = useCallback((sugerencia: SugerenciaTexto) => {
    setIgnoradas((prev) => new Set(prev).add(claveIgnorada(sugerencia)))
  }, [])

  return { sugerencias: visibles, revisando, revisado, noDisponible, aplicar, ignorar }
}
