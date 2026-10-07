import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Avatar } from './Avatar'
import { useUsuariosActivos, type UsuarioActivo } from '../hooks/useUsuariosActivos'
import { normalizar } from '../lib/ticket'
import { notificarMenciones } from '../lib/notificaciones'
import type { Profile, TicketComentario } from '../types/database'

type PerfilCorto = Pick<Profile, 'id' | 'full_name' | 'email'>

type ComentarioConRelaciones = TicketComentario & {
  autor: PerfilCorto | null
  menciones: { profile: PerfilCorto | null }[]
}

const MAX_SUGERENCIAS = 6

function nombreDe(persona: PerfilCorto): string {
  return persona.full_name?.trim() || persona.email
}

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Resalta los "@Nombre" de las personas que de verdad quedaron mencionadas.
function TextoConMenciones({ texto, nombres }: { texto: string; nombres: string[] }) {
  if (nombres.length === 0) return <>{texto}</>
  const patron = new RegExp(`(@(?:${nombres.map(escaparRegex).join('|')}))`, 'g')
  return (
    <>
      {texto.split(patron).map((parte, indice) => (
        indice % 2 === 1
          ? <span key={indice} className="comentario__mencion">{parte}</span>
          : <Fragment key={indice}>{parte}</Fragment>
      ))}
    </>
  )
}

interface ComentariosTicketProps {
  ticketId: string
  onComentado?: () => void
}

export function ComentariosTicket({ ticketId, onComentado }: ComentariosTicketProps) {
  const { profile } = useAuth()
  const usuarios = useUsuariosActivos()
  const [comentarios, setComentarios] = useState<ComentarioConRelaciones[]>([])
  const [loading, setLoading] = useState(true)
  const [texto, setTexto] = useState('')
  // Personas elegidas en el autocompletado; al enviar solo cuentan las que
  // siguen escritas en el texto.
  const [mencionados, setMencionados] = useState<UsuarioActivo[]>([])
  const [consulta, setConsulta] = useState<{ termino: string; inicio: number } | null>(null)
  const [indiceSugerencia, setIndiceSugerencia] = useState(0)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [avisoMencion, setAvisoMencion] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const cargar = useCallback(async () => {
    const { data, error: errorCarga } = await supabase
      .from('ticket_comentarios')
      // Los nombres de las FK son obligatorios: ticket_menciones también une
      // comentarios con personas, y sin ellos PostgREST rechaza la consulta
      // por relación ambigua.
      .select(`
        *,
        autor:profiles!ticket_comentarios_autor_id_fkey(id, full_name, email),
        menciones:ticket_menciones!ticket_menciones_comentario_id_fkey(
          profile:profiles!ticket_menciones_profile_id_fkey(id, full_name, email)
        )
      `)
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true })
    if (errorCarga) console.error('No se pudieron cargar los comentarios:', errorCarga.message)
    setErrorCarga(errorCarga ? 'No se pudieron cargar los comentarios.' : null)
    setComentarios((data as unknown as ComentarioConRelaciones[]) ?? [])
    setLoading(false)
  }, [ticketId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const sugerencias = useMemo(() => {
    if (!consulta) return []
    const termino = normalizar(consulta.termino)
    return usuarios
      .filter((u) => u.id !== profile?.id)
      .filter((u) => normalizar(nombreDe(u)).includes(termino) || u.email.toLowerCase().includes(termino))
      .slice(0, MAX_SUGERENCIAS)
  }, [consulta, usuarios, profile?.id])

  function actualizarConsulta(valor: string, cursor: number) {
    // "@" al inicio o después de un espacio, seguido de lo que se va escribiendo.
    const coincidencia = valor.slice(0, cursor).match(/(?:^|\s)@([^\s@]{0,30})$/)
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
    const nuevoTexto = texto.slice(0, consulta.inicio) + insercion + texto.slice(cursor)
    const nuevoCursor = consulta.inicio + insercion.length
    setTexto(nuevoTexto)
    setMencionados((prev) => (prev.some((m) => m.id === usuario.id) ? prev : [...prev, usuario]))
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
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void enviar()
    }
  }

  async function enviar(e?: FormEvent) {
    e?.preventDefault()
    if (!texto.trim() || enviando) return
    setEnviando(true)
    setError(null)
    setAvisoMencion(null)

    const personasMencionadas = mencionados.filter((m) => texto.includes(`@${nombreDe(m)}`))
    const idsMencionados = personasMencionadas.map((m) => m.id)

    const { data: comentarioId, error: errorComentario } = await supabase.rpc('comentar_ticket', {
      p_ticket_id: ticketId,
      p_texto: texto,
      p_mencionados: idsMencionados,
    })

    setEnviando(false)
    if (errorComentario) console.error('No se pudo publicar el comentario:', errorComentario.message)
    if (errorComentario || !comentarioId) {
      setError('No se pudo publicar el comentario. Intenta de nuevo.')
      return
    }

    const textoEnviado = texto
    setTexto('')
    setMencionados([])
    setConsulta(null)
    onComentado?.()
    void cargar()

    if (idsMencionados.length === 0) {
      // "@algo" escrito a mano, sin elegir a la persona de la lista.
      if (/(^|\s)@[^\s@]/.test(textoEnviado)) {
        setAvisoMencion({
          tipo: 'error',
          texto: 'No se mencionó a nadie: para notificar a alguien elige su nombre de la lista que aparece al escribir @.',
        })
      }
      return
    }

    const nombres = personasMencionadas.map(nombreDe).join(', ')
    const resultado = await notificarMenciones(comentarioId as string)
    setAvisoMencion(resultado.ok
      ? { tipo: 'ok', texto: `Se notificó por correo a ${nombres}.` }
      : {
          tipo: 'error',
          texto: `El comentario se publicó, pero no se pudo enviar el correo a ${nombres}${resultado.detalle ? `: ${resultado.detalle}` : '.'}`,
        })
  }

  const miNombre = profile ? profile.full_name?.trim() || profile.email : 'Yo'

  return (
    <div className="comentarios-panel">
      {loading ? (
        <p className="actividad__vacio">Cargando comentarios...</p>
      ) : errorCarga ? (
        <p className="auth-error">{errorCarga}</p>
      ) : comentarios.length === 0 ? (
        <p className="actividad__vacio">
          Aún no hay comentarios. Inicia la conversación o menciona a alguien con <strong>@</strong>.
        </p>
      ) : (
        <ul className="comentarios">
          {comentarios.map((comentario) => {
            const autor = comentario.autor ? nombreDe(comentario.autor) : 'Usuario eliminado'
            return (
              <li key={comentario.id} className="comentario">
                <Avatar nombre={autor} />
                <div className="comentario__contenido">
                  <div className="comentario__cabecera">
                    <strong>{autor}</strong>
                    <time dateTime={comentario.created_at}>{formatearFecha(comentario.created_at)}</time>
                  </div>
                  <p className="comentario__texto">
                    <TextoConMenciones
                      texto={comentario.texto}
                      nombres={comentario.menciones.flatMap((m) => (m.profile ? [nombreDe(m.profile)] : []))}
                    />
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {avisoMencion && (
        <p className={`comentarios__aviso comentarios__aviso--${avisoMencion.tipo}`} role="status">
          {avisoMencion.texto}
        </p>
      )}

      <form className="comentarios__nuevo" onSubmit={enviar}>
        <Avatar nombre={miNombre} />
        <div className="comentarios__caja">
          <div className="comentarios__campo">
            <textarea
              ref={textareaRef}
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value)
                actualizarConsulta(e.target.value, e.target.selectionStart)
              }}
              onKeyDown={handleKeyDown}
              onClick={(e) => actualizarConsulta(texto, e.currentTarget.selectionStart)}
              onBlur={() => setConsulta(null)}
              placeholder="Escribe un comentario… usa @ para mencionar a alguien"
              rows={2}
              maxLength={5000}
              aria-label="Nuevo comentario"
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
          <div className="comentarios__acciones">
            {error
              ? <p className="auth-error">{error}</p>
              : <span className="comentarios__ayuda"><kbd>@</kbd> mencionar · <kbd>Ctrl</kbd> + <kbd>Enter</kbd> enviar</span>}
            <button type="submit" disabled={enviando || !texto.trim()}>
              {enviando ? 'Enviando...' : 'Comentar'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
