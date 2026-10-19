import { Fragment, useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Avatar } from './Avatar'
import { ArchivoAdjunto, IconoArchivo } from './ArchivoAdjunto'
import { CampoMenciones } from './CampoMenciones'
import { SugerenciasTexto } from './SugerenciasTexto'
import { mencionadosEnTexto, nombreDe } from '../lib/menciones'
import {
  ARCHIVO_COMENTARIO_EXTENSIONES,
  ARCHIVO_COMENTARIO_MAX_MB,
  ARCHIVOS_POR_COMENTARIO,
  pesoLegible,
  subirArchivoComentario,
  urlArchivo,
  urlDescarga,
  validarArchivoComentario,
} from '../lib/archivos'
import type { UsuarioActivo } from '../hooks/useUsuariosActivos'
import { notificarMenciones } from '../lib/notificaciones'
import type { Profile, TicketArchivo, TicketComentario } from '../types/database'

type PerfilCorto = Pick<Profile, 'id' | 'full_name' | 'email'>

type ComentarioConRelaciones = TicketComentario & {
  autor: PerfilCorto | null
  menciones: { profile: PerfilCorto | null }[]
  archivos: Pick<TicketArchivo, 'id' | 'ruta' | 'nombre' | 'tamano' | 'created_at'>[]
}

const ACCEPT_ARCHIVOS = ARCHIVO_COMENTARIO_EXTENSIONES.map((extension) => `.${extension}`).join(',')

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
  const [archivos, setArchivos] = useState<File[]>([])
  const [arrastrandoArchivo, setArrastrandoArchivo] = useState(false)
  const archivoInputRef = useRef<HTMLInputElement>(null)

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
        ),
        archivos:ticket_archivos!ticket_archivos_comentario_id_fkey(id, ruta, nombre, tamano, created_at)
      `)
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true })
      .order('created_at', { referencedTable: 'archivos', ascending: true })
    if (errorCarga) console.error('No se pudieron cargar los comentarios:', errorCarga.message)
    setErrorCarga(errorCarga ? 'No se pudieron cargar los comentarios.' : null)
    setComentarios((data as unknown as ComentarioConRelaciones[]) ?? [])
    setLoading(false)
  }, [ticketId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  function agregarArchivos(nuevos: File[]) {
    if (nuevos.length === 0) return
    setError(null)
    const rechazo = nuevos.map(validarArchivoComentario).find((motivo) => motivo !== null)
    if (rechazo) {
      setError(rechazo)
      return
    }
    // Volver a elegir el mismo archivo no lo duplica.
    const yaElegidos = new Set(archivos.map((a) => `${a.name}|${a.size}`))
    const combinados = [...archivos, ...nuevos.filter((a) => !yaElegidos.has(`${a.name}|${a.size}`))]
    if (combinados.length > ARCHIVOS_POR_COMENTARIO) {
      setError(`Puedes adjuntar hasta ${ARCHIVOS_POR_COMENTARIO} archivos por comentario.`)
      return
    }
    setArchivos(combinados)
  }

  function quitarArchivo(indice: number) {
    setArchivos((prev) => prev.filter((_, i) => i !== indice))
    setError(null)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setArrastrandoArchivo(false)
    agregarArchivos(Array.from(e.dataTransfer.files))
  }

  async function enviar(e?: FormEvent) {
    e?.preventDefault()
    if ((!texto.trim() && archivos.length === 0) || enviando) return
    setEnviando(true)
    setError(null)
    setAvisoMencion(null)

    const personasMencionadas = mencionadosEnTexto(texto, mencionados)
    const idsMencionados = personasMencionadas.map((m) => m.id)

    // Primero se suben los archivos; comentar_ticket() verifica que existan
    // antes de registrarlos con el comentario.
    let subidos
    try {
      subidos = await Promise.all(archivos.map((archivo) => subirArchivoComentario(ticketId, archivo)))
    } catch (errorSubida) {
      console.error('No se pudieron subir los archivos:', errorSubida)
      setEnviando(false)
      setError('No se pudieron subir los archivos. Intenta de nuevo.')
      return
    }

    const { data: comentarioId, error: errorComentario } = await supabase.rpc('comentar_ticket', {
      p_ticket_id: ticketId,
      p_texto: texto,
      p_mencionados: idsMencionados,
      p_archivos: subidos,
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
    setArchivos([])
    if (archivoInputRef.current) archivoInputRef.current.value = ''
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
                  {comentario.texto && (
                    <p className="comentario__texto">
                      <TextoConMenciones
                        texto={comentario.texto}
                        nombres={comentario.menciones.flatMap((m) => (m.profile ? [nombreDe(m.profile)] : []))}
                      />
                    </p>
                  )}
                  {comentario.archivos.length > 0 && (
                    <div className="comentario__archivos">
                      {comentario.archivos.map((archivo) => (
                        <ArchivoAdjunto
                          key={archivo.id}
                          nombre={archivo.nombre}
                          tamano={archivo.tamano}
                          url={urlArchivo(archivo.ruta)}
                          urlDescarga={urlDescarga(archivo.ruta, archivo.nombre)}
                        />
                      ))}
                    </div>
                  )}
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
        <div
          className={`comentarios__caja${arrastrandoArchivo ? ' comentarios__caja--arrastrando' : ''}`}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            setArrastrandoArchivo(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setArrastrandoArchivo(false)
          }}
          onDrop={handleDrop}
        >
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
            spellCheck
            lang="es"
            aria-label="Nuevo comentario"
          />
          <SugerenciasTexto
            texto={texto}
            onCambiar={setTexto}
            protegidos={mencionados.map((m) => `@${nombreDe(m)}`)}
          />
          {archivos.length > 0 && (
            <ul className="comentarios__adjuntos" aria-label="Archivos por adjuntar">
              {archivos.map((archivo, indice) => (
                <li key={`${archivo.name}|${archivo.size}`} className="comentarios__adjunto">
                  <IconoArchivo nombre={archivo.name} />
                  <span className="comentarios__adjunto-nombre" title={archivo.name}>{archivo.name}</span>
                  <span className="comentarios__adjunto-peso">{pesoLegible(archivo.size)}</span>
                  <button
                    type="button"
                    className="comentarios__adjunto-quitar"
                    onClick={() => quitarArchivo(indice)}
                    disabled={enviando}
                    aria-label={`Quitar ${archivo.name}`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="comentarios__acciones">
            <input
              ref={archivoInputRef}
              type="file"
              multiple
              accept={ACCEPT_ARCHIVOS}
              hidden
              onChange={(e) => {
                agregarArchivos(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
            <button
              type="button"
              className="comentarios__adjuntar"
              onClick={() => archivoInputRef.current?.click()}
              disabled={enviando || archivos.length >= ARCHIVOS_POR_COMENTARIO}
              title={`Adjuntar archivos (Word, Excel, PDF, JPG, PNG o ZIP · máx. ${ARCHIVO_COMENTARIO_MAX_MB} MB c/u)`}
              aria-label="Adjuntar archivos"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" />
              </svg>
            </button>
            {error
              ? <p className="auth-error">{error}</p>
              : <span className="comentarios__ayuda"><kbd>@</kbd> mencionar · <kbd>Ctrl</kbd> + <kbd>Enter</kbd> enviar</span>}
            <button type="submit" disabled={enviando || (!texto.trim() && archivos.length === 0)}>
              {enviando ? (archivos.length > 0 ? 'Subiendo...' : 'Enviando...') : 'Comentar'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
