import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Avatar } from './Avatar'
import { CampoMenciones } from './CampoMenciones'
import { mencionadosEnTexto, nombreDe } from '../lib/menciones'
import type { UsuarioActivo } from '../hooks/useUsuariosActivos'
import { notificarMenciones } from '../lib/notificaciones'
import type { Profile, TicketComentario } from '../types/database'

type PerfilCorto = Pick<Profile, 'id' | 'full_name' | 'email'>

type ComentarioConRelaciones = TicketComentario & {
  autor: PerfilCorto | null
  menciones: { profile: PerfilCorto | null }[]
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
  const [comentarios, setComentarios] = useState<ComentarioConRelaciones[]>([])
  const [loading, setLoading] = useState(true)
  const [texto, setTexto] = useState('')
  // Personas elegidas en el autocompletado; al enviar solo cuentan las que
  // siguen escritas en el texto.
  const [mencionados, setMencionados] = useState<UsuarioActivo[]>([])
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [avisoMencion, setAvisoMencion] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

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

  async function enviar(e?: FormEvent) {
    e?.preventDefault()
    if (!texto.trim() || enviando) return
    setEnviando(true)
    setError(null)
    setAvisoMencion(null)

    const personasMencionadas = mencionadosEnTexto(texto, mencionados)
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
          <CampoMenciones
            valor={texto}
            onCambiar={setTexto}
            mencionados={mencionados}
            onCambiarMencionados={setMencionados}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void enviar()
              }
            }}
            placeholder="Escribe un comentario… usa @ para mencionar a alguien"
            rows={2}
            maxLength={5000}
            aria-label="Nuevo comentario"
          />
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
