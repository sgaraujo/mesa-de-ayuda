import { useMemo, useRef, useState, type KeyboardEvent, type TextareaHTMLAttributes } from 'react'
import { useAuth } from '../context/AuthContext'
import { useUsuariosActivos, type UsuarioActivo } from '../hooks/useUsuariosActivos'
import { normalizar } from '../lib/ticket'
import { nombreDe } from '../lib/menciones'
import { Avatar } from './Avatar'

const MAX_SUGERENCIAS = 6

type AtributosTextarea = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'onKeyDown'>

interface CampoMencionesProps extends AtributosTextarea {
  valor: string
  onCambiar: (valor: string) => void
  mencionados: UsuarioActivo[]
  onCambiarMencionados: (mencionados: UsuarioActivo[]) => void
  // Teclas que no consume el autocompletado (p. ej. Ctrl + Enter para enviar).
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
}

// Textarea con autocompletado de menciones: al escribir "@" y unas letras
// aparece la lista de personas activas; se elige con clic, flechas + Enter o
// Tab. Lo usan los comentarios y la nota de finalización.
export function CampoMenciones({
  valor,
  onCambiar,
  mencionados,
  onCambiarMencionados,
  onKeyDown,
  ...atributos
}: CampoMencionesProps) {
  const { profile } = useAuth()
  const usuarios = useUsuariosActivos()
  const [consulta, setConsulta] = useState<{ termino: string; inicio: number } | null>(null)
  const [indiceSugerencia, setIndiceSugerencia] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const sugerencias = useMemo(() => {
    if (!consulta) return []
    const termino = normalizar(consulta.termino)
    return usuarios
      .filter((u) => u.id !== profile?.id)
      .filter((u) => normalizar(nombreDe(u)).includes(termino) || u.email.toLowerCase().includes(termino))
      .slice(0, MAX_SUGERENCIAS)
  }, [consulta, usuarios, profile?.id])

  function actualizarConsulta(texto: string, cursor: number) {
    // "@" al inicio o después de un espacio, seguido de lo que se va escribiendo.
    const coincidencia = texto.slice(0, cursor).match(/(?:^|\s)@([^\s@]{0,30})$/)
    if (coincidencia) {
      setConsulta({ termino: coincidencia[1], inicio: cursor - coincidencia[1].length - 1 })
      setIndiceSugerencia(0)
    } else {
      setConsulta(null)
    }
  }

  function elegir(usuario: UsuarioActivo) {
    if (!consulta) return
    const cursor = consulta.inicio + 1 + consulta.termino.length
    const insercion = `@${nombreDe(usuario)} `
    const nuevoTexto = valor.slice(0, consulta.inicio) + insercion + valor.slice(cursor)
    const nuevoCursor = consulta.inicio + insercion.length
    onCambiar(nuevoTexto)
    if (!mencionados.some((m) => m.id === usuario.id)) onCambiarMencionados([...mencionados, usuario])
    setConsulta(null)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nuevoCursor, nuevoCursor)
    })
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (consulta && sugerencias.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const paso = e.key === 'ArrowDown' ? 1 : -1
        setIndiceSugerencia((i) => (i + paso + sugerencias.length) % sugerencias.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        elegir(sugerencias[indiceSugerencia])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setConsulta(null)
        return
      }
    }
    onKeyDown?.(e)
  }

  return (
    <div className="comentarios__campo">
      <textarea
        {...atributos}
        ref={textareaRef}
        value={valor}
        onChange={(e) => {
          onCambiar(e.target.value)
          actualizarConsulta(e.target.value, e.target.selectionStart)
        }}
        onKeyDown={handleKeyDown}
        onClick={(e) => actualizarConsulta(valor, e.currentTarget.selectionStart)}
        onBlur={() => setConsulta(null)}
        aria-autocomplete="list"
        aria-expanded={sugerencias.length > 0}
      />
      {sugerencias.length > 0 && (
        <ul className="comentarios__sugerencias" role="listbox">
          {sugerencias.map((usuario, indice) => (
            <li
              key={usuario.id}
              role="option"
              aria-selected={indice === indiceSugerencia}
              className={`comentarios__sugerencia${indice === indiceSugerencia ? ' comentarios__sugerencia--activa' : ''}`}
              // mousedown para que el blur del textarea no cierre la lista antes del clic.
              onMouseDown={(e) => {
                e.preventDefault()
                elegir(usuario)
              }}
            >
              <Avatar nombre={nombreDe(usuario)} tamano="sm" />
              <span className="comentarios__sugerencia-nombre">{nombreDe(usuario)}</span>
              <span className="comentarios__sugerencia-correo">{usuario.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
