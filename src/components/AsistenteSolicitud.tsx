import { useState } from 'react'
import { supabase } from '../lib/supabase'

interface Propuesta {
  titulo: string
  descripcion: string
  preguntas: string[]
}

interface AsistenteSolicitudProps {
  titulo: string
  descripcion: string
  area?: string
  tipo?: string
  onUsar: (titulo: string, descripcion: string) => void
}

const MINIMO_CARACTERES = 15

// Botón "Mejorar con IA" bajo la descripción: Gemini (Edge Function
// asistente-solicitud) propone una versión más clara del título y la
// descripción, y las preguntas que el equipo haría. Nada cambia hasta que la
// persona elige usar la propuesta.
export function AsistenteSolicitud({ titulo, descripcion, area, tipo, onUsar }: AsistenteSolicitudProps) {
  const [cargando, setCargando] = useState(false)
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hayBorrador = (titulo.trim() + descripcion.trim()).length >= MINIMO_CARACTERES

  async function pedirPropuesta() {
    setCargando(true)
    setError(null)
    setPropuesta(null)
    const { data, error: errorAsistente } = await supabase.functions.invoke('asistente-solicitud', {
      body: { titulo, descripcion, area, tipo },
    })
    setCargando(false)
    if (errorAsistente || !data?.ok) {
      let detalle = (data as { message?: string } | null)?.message
      try {
        const cuerpo = await (errorAsistente as { context?: Response } | null)?.context?.json()
        detalle = cuerpo?.message ?? detalle
      } catch {
        // Sin cuerpo JSON: queda el mensaje genérico.
      }
      setError(detalle ?? 'El asistente no está disponible en este momento.')
      return
    }
    setPropuesta(data as Propuesta)
  }

  return (
    <div className="asistente">
      {!propuesta && (
        <div className="asistente__barra">
          <button
            type="button"
            className="asistente__boton"
            onClick={() => void pedirPropuesta()}
            disabled={cargando || !hayBorrador}
            title={hayBorrador ? undefined : 'Escribe primero un borrador de lo que necesitas'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
            </svg>
            {cargando ? 'Pensando…' : 'Mejorar con IA'}
          </button>
          <span className="asistente__ayuda">Ordena tu idea y te dice qué información falta.</span>
        </div>
      )}
      {error && <p className="auth-error">{error}</p>}

      {propuesta && (
        <section className="asistente__propuesta" aria-live="polite" aria-label="Propuesta del asistente">
          <p className="asistente__etiqueta">Propuesta del asistente</p>
          <p className="asistente__titulo">{propuesta.titulo}</p>
          <p className="asistente__descripcion">{propuesta.descripcion}</p>
          {propuesta.preguntas.length > 0 && (
            <div className="asistente__preguntas">
              <p>Para que el equipo la atienda sin preguntarte, agrega:</p>
              <ul>
                {propuesta.preguntas.map((pregunta) => <li key={pregunta}>{pregunta}</li>)}
              </ul>
            </div>
          )}
          <div className="asistente__acciones">
            <button type="button" className="asistente__descartar" onClick={() => setPropuesta(null)}>
              Descartar
            </button>
            <button
              type="button"
              onClick={() => {
                onUsar(propuesta.titulo, propuesta.descripcion)
                setPropuesta(null)
              }}
            >
              Usar esta versión
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
