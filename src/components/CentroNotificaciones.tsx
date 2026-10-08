import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useArea } from '../context/AreaContext'
import { TICKET_SELECT } from '../lib/ticket'
import { Avatar } from './Avatar'
import { TicketDetalleModal } from './TicketDetalleModal'
import type { Notificacion, Profile, Ticket, TicketConRelaciones } from '../types/database'

type NotificacionConRelaciones = Notificacion & {
  actor: Pick<Profile, 'full_name' | 'email'> | null
  ticket: Pick<Ticket, 'numero' | 'titulo'> | null
}

const LIMITE = 50
const DURACION_AVISO_MS = 6000

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
}

const SELECT_NOTIFICACIONES = `
  *,
  actor:profiles!notificaciones_actor_id_fkey(full_name, email),
  ticket:tickets(numero, titulo)
`

const formatoRelativo = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })

function hace(iso: string): string {
  const segundos = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  const unidades: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  for (const [unidad, tamano] of unidades) {
    if (Math.abs(segundos) >= tamano) return formatoRelativo.format(Math.round(segundos / tamano), unidad)
  }
  return 'ahora'
}

function nombreActor(n: NotificacionConRelaciones): string {
  return n.actor?.full_name?.trim() || n.actor?.email || 'Alguien'
}

// Texto principal: quién hizo qué y sobre qué tarea.
function Mensaje({ n }: { n: NotificacionConRelaciones }) {
  const actor = <strong>{nombreActor(n)}</strong>
  const tarea = <strong>{n.ticket ? `#${n.ticket.numero} ${n.ticket.titulo}` : 'una tarea'}</strong>
  switch (n.tipo) {
    case 'mencion':
      return <>{actor} te mencionó en {tarea}</>
    case 'comentario':
      return <>{actor} comentó en {tarea}</>
    case 'asignacion':
      return <>{actor} te asignó {tarea}</>
    case 'estado':
      return n.detalle === 'finalizado'
        ? <>{actor} finalizó tu solicitud {tarea}</>
        : <>{actor} pasó tu solicitud {tarea} a <strong>{ESTADO_LABEL[n.detalle ?? ''] ?? n.detalle}</strong></>
  }
}

const ICONO_TIPO: Record<Notificacion['tipo'], string> = {
  mencion: '@',
  comentario: '💬',
  asignacion: '→',
  estado: '✓',
}

// Campanita del encabezado con el panel de notificaciones. Al tocar una se
// abre la tarea aquí mismo, desde cualquier página.
export function CentroNotificaciones() {
  const { profile } = useAuth()
  const { areas } = useArea()
  const profileId = profile?.id

  const [notificaciones, setNotificaciones] = useState<NotificacionConRelaciones[]>([])
  const [sinLeer, setSinLeer] = useState(0)
  const [abierto, setAbierto] = useState(false)
  const [soloNoLeidas, setSoloNoLeidas] = useState(false)
  const [aviso, setAviso] = useState<NotificacionConRelaciones | null>(null)
  const [ticketAbierto, setTicketAbierto] = useState<TicketConRelaciones | null>(null)
  const [errorTicket, setErrorTicket] = useState<string | null>(null)
  const contenedorRef = useRef<HTMLDivElement>(null)
  const temporizadorAviso = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cargar = useCallback(async () => {
    if (!profileId) return
    const [{ data }, { count }] = await Promise.all([
      supabase
        .from('notificaciones')
        .select(SELECT_NOTIFICACIONES)
        .eq('destinatario_id', profileId)
        .order('created_at', { ascending: false })
        .limit(LIMITE),
      supabase
        .from('notificaciones')
        .select('id', { count: 'exact', head: true })
        .eq('destinatario_id', profileId)
        .is('leida_at', null),
    ])
    setNotificaciones((data as unknown as NotificacionConRelaciones[]) ?? [])
    setSinLeer(count ?? 0)
  }, [profileId])

  useEffect(() => {
    if (!profileId) return
    void cargar()

    const canal = supabase
      .channel(`notificaciones:${profileId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notificaciones', filter: `destinatario_id=eq.${profileId}` },
        async ({ new: fila }) => {
          await cargar()
          // Aviso flotante con la notificación recién llegada.
          const { data } = await supabase
            .from('notificaciones')
            .select(SELECT_NOTIFICACIONES)
            .eq('id', (fila as Notificacion).id)
            .maybeSingle()
          if (!data) return
          setAviso(data as unknown as NotificacionConRelaciones)
          if (temporizadorAviso.current) clearTimeout(temporizadorAviso.current)
          temporizadorAviso.current = setTimeout(() => setAviso(null), DURACION_AVISO_MS)
        },
      )
      .subscribe()

    return () => {
      if (temporizadorAviso.current) clearTimeout(temporizadorAviso.current)
      void supabase.removeChannel(canal)
    }
  }, [profileId, cargar])

  // Cerrar el panel al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!abierto) return
    function alClicFuera(e: MouseEvent) {
      if (!contenedorRef.current?.contains(e.target as Node)) setAbierto(false)
    }
    function alTeclear(e: KeyboardEvent) {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', alClicFuera)
    document.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('mousedown', alClicFuera)
      document.removeEventListener('keydown', alTeclear)
    }
  }, [abierto])

  async function marcarLeidas(ids: string[] | null) {
    const ahora = new Date().toISOString()
    setNotificaciones((prev) => prev.map((n) => (
      !n.leida_at && (ids === null || ids.includes(n.id)) ? { ...n, leida_at: ahora } : n
    )))
    setSinLeer((prev) => (ids === null ? 0 : Math.max(0, prev - ids.length)))
    await supabase.rpc('marcar_notificaciones_leidas', { p_ids: ids })
  }

  async function abrir(n: NotificacionConRelaciones) {
    setAbierto(false)
    setAviso(null)
    setErrorTicket(null)
    if (!n.leida_at) void marcarLeidas([n.id])

    const { data } = await supabase.from('tickets').select(TICKET_SELECT).eq('id', n.ticket_id).maybeSingle()
    if (!data) {
      setErrorTicket('Ya no tienes acceso a esa tarea o fue eliminada.')
      return
    }
    setTicketAbierto(data as unknown as TicketConRelaciones)
  }

  const visibles = soloNoLeidas ? notificaciones.filter((n) => !n.leida_at) : notificaciones
  // Permisos al abrir una tarea: los mismos que en el tablero de su área.
  const rolEnArea = ticketAbierto ? areas.find((a) => a.id === ticketAbierto.area_id)?.rol : undefined

  return (
    <div className="notificaciones" ref={contenedorRef}>
      <button
        type="button"
        className={`notificaciones__campana${sinLeer > 0 ? ' notificaciones__campana--pendientes' : ''}`}
        onClick={() => setAbierto((v) => !v)}
        aria-label={sinLeer > 0 ? `Notificaciones, ${sinLeer} sin leer` : 'Notificaciones'}
        aria-expanded={abierto}
        aria-haspopup="dialog"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {sinLeer > 0 && <span className="notificaciones__contador">{sinLeer > 99 ? '99+' : sinLeer}</span>}
      </button>

      {abierto && (
        <div className="notificaciones__panel" role="dialog" aria-label="Notificaciones">
          <div className="notificaciones__cabecera">
            <h2>Notificaciones</h2>
            {sinLeer > 0 && (
              <button type="button" className="notificaciones__marcar" onClick={() => void marcarLeidas(null)}>
                Marcar todas como leídas
              </button>
            )}
          </div>
          <div className="segmentado notificaciones__filtro" role="group" aria-label="Filtrar notificaciones">
            <button type="button" aria-pressed={!soloNoLeidas} onClick={() => setSoloNoLeidas(false)}>
              Todas
            </button>
            <button type="button" aria-pressed={soloNoLeidas} onClick={() => setSoloNoLeidas(true)}>
              No leídas{sinLeer > 0 && ` (${sinLeer})`}
            </button>
          </div>

          {visibles.length === 0 ? (
            <div className="notificaciones__vacio">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
              {soloNoLeidas ? 'Estás al día: no tienes notificaciones sin leer.' : 'Todavía no tienes notificaciones.'}
            </div>
          ) : (
            <ul className="notificaciones__lista">
              {visibles.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`notificacion${n.leida_at ? '' : ' notificacion--nueva'}`}
                    onClick={() => void abrir(n)}
                  >
                    <span className="notificacion__avatar">
                      <Avatar nombre={nombreActor(n)} />
                      <span className={`notificacion__tipo notificacion__tipo--${n.tipo}`} aria-hidden="true">
                        {ICONO_TIPO[n.tipo]}
                      </span>
                    </span>
                    <span className="notificacion__contenido">
                      <span className="notificacion__texto"><Mensaje n={n} /></span>
                      {n.detalle && n.tipo !== 'estado' && (
                        <span className="notificacion__extracto">{n.detalle}</span>
                      )}
                      <time className="notificacion__fecha" dateTime={n.created_at}>{hace(n.created_at)}</time>
                    </span>
                    {!n.leida_at && <span className="notificacion__punto" aria-label="Sin leer" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Fuera del encabezado (portal): su backdrop-filter atraparía los
          elementos position: fixed. */}
      {aviso && !abierto && createPortal((
        <button type="button" className="notificaciones__aviso" onClick={() => void abrir(aviso)}>
          <Avatar nombre={nombreActor(aviso)} />
          <span>
            <span className="notificacion__texto"><Mensaje n={aviso} /></span>
            {aviso.detalle && aviso.tipo !== 'estado' && (
              <span className="notificacion__extracto">{aviso.detalle}</span>
            )}
          </span>
        </button>
      ), document.body)}

      {errorTicket && createPortal((
        <div className="notificaciones__aviso notificaciones__aviso--error" role="alert">
          <span>{errorTicket}</span>
          <button type="button" className="notificaciones__cerrar-error" onClick={() => setErrorTicket(null)} aria-label="Cerrar">
            ×
          </button>
        </div>
      ), document.body)}

      {ticketAbierto && createPortal((
        <TicketDetalleModal
          ticket={ticketAbierto}
          puedeEditarTiempos={rolEnArea !== undefined}
          puedeEliminar={rolEnArea === 'lider'}
          onClose={() => setTicketAbierto(null)}
          onGuardado={() => setTicketAbierto(null)}
          onEliminado={() => setTicketAbierto(null)}
        />
      ), document.body)}
    </div>
  )
}
