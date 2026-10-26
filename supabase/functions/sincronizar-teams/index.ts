// Edge Function: sincronizar-teams
// La llama pg_cron cada 15 minutos (migración 0045) con el header
// x-cron-key = secreto TEAMS_CRON_KEY; se despliega con --no-verify-jwt.
//
// Lee con Microsoft Graph (permiso Calendars.Read de aplicación, con
// consentimiento del administrador del tenant) el calendario de cada líder y
// agente, desde 2 días atrás hasta 30 días adelante, y registra cada reunión
// de Teams que la persona organiza con registrar_reunion_teams(). Solo el
// calendario del organizador: así cada reunión entra una vez. Las reuniones
// marcadas como privadas en Outlook no se importan.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, MS_GRAPH_URL, obtenerTokenGraph } from '../_shared/graph.ts'
import { esCorreoInterno } from '../_shared/cedula.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const DIAS_ATRAS = 2
const DIAS_ADELANTE = 30

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

interface EventoGraph {
  iCalUId: string
  subject: string | null
  bodyPreview: string | null
  start: { dateTime: string }
  end: { dateTime: string }
  isCancelled: boolean
  isOnlineMeeting: boolean
  onlineMeetingProvider: string | null
  onlineMeeting: { joinUrl: string | null } | null
  sensitivity: string
  organizer: { emailAddress: { name: string | null; address: string | null } } | null
  attendees: { type: string; emailAddress: { name: string | null; address: string | null } }[]
}

interface Organizador {
  id: string
  email: string
  nombre: string
  areaId: string
}

// Con Prefer: outlook.timezone="UTC" las fechas vienen en UTC sin la "Z".
const aIso = (fechaUtc: string) => new Date(fechaUtc.endsWith('Z') ? fechaUtc : `${fechaUtc}Z`).toISOString()

function formatear(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full', timeStyle: 'short' })
}

function duracion(inicio: string, fin: string): string {
  const minutos = Math.max(0, Math.round((new Date(fin).getTime() - new Date(inicio).getTime()) / 60000))
  const horas = Math.floor(minutos / 60)
  return [horas ? `${horas} h` : '', minutos % 60 ? `${minutos % 60} min` : ''].filter(Boolean).join(' ') || '0 min'
}

function describir(evento: EventoGraph, organizador: Organizador, inicio: string, fin: string): string {
  const invitados = evento.attendees
    .filter((a) => a.type !== 'resource')
    .map((a) => a.emailAddress.name || a.emailAddress.address)
    .filter(Boolean)
  const agenda = evento.bodyPreview?.trim()
  return [
    'Reunión de Microsoft Teams (importada automáticamente del calendario).',
    '',
    `Fecha: ${formatear(inicio)}`,
    `Duración: ${duracion(inicio, fin)}`,
    `Organiza: ${organizador.nombre}`,
    `Invitados (${invitados.length}): ${invitados.join(', ') || 'ninguno'}`,
    ...(agenda ? ['', 'Agenda:', agenda] : []),
  ].join('\n')
}

// Líderes y agentes activos con correo corporativo. Si están en varias áreas,
// la reunión va a la que lideran o, si no lideran ninguna, a la primera.
async function organizadores(): Promise<Organizador[]> {
  const { data, error } = await supabaseAdmin
    .from('area_miembros')
    .select('rol, profile:profiles(id, email, full_name, activo), area:areas(id, orden)')
  if (error) throw error

  type Fila = { rol: string; profile: { id: string; email: string; full_name: string | null; activo: boolean } | null; area: { id: string; orden: number } | null }
  const porPersona = new Map<string, { fila: Fila; orden: number }>()
  for (const fila of (data ?? []) as unknown as Fila[]) {
    if (!fila.profile?.activo || !fila.area || esCorreoInterno(fila.profile.email)) continue
    const orden = (fila.rol === 'lider' ? 0 : 100000) + fila.area.orden
    const previo = porPersona.get(fila.profile.id)
    if (!previo || orden < previo.orden) porPersona.set(fila.profile.id, { fila, orden })
  }
  return [...porPersona.values()].map(({ fila }) => ({
    id: fila.profile!.id,
    email: fila.profile!.email,
    nombre: fila.profile!.full_name?.trim() || fila.profile!.email,
    areaId: fila.area!.id,
  }))
}

async function eventosDe(token: string, email: string): Promise<EventoGraph[]> {
  const desde = new Date(Date.now() - DIAS_ATRAS * 86400000).toISOString()
  const hasta = new Date(Date.now() + DIAS_ADELANTE * 86400000).toISOString()
  const campos = 'iCalUId,subject,bodyPreview,start,end,isCancelled,isOnlineMeeting,onlineMeetingProvider,onlineMeeting,sensitivity,organizer,attendees'
  let url: string | null = `${MS_GRAPH_URL}/users/${encodeURIComponent(email)}/calendarView`
    + `?startDateTime=${desde}&endDateTime=${hasta}&$select=${campos}&$top=100`
  const eventos: EventoGraph[] = []
  while (url) {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' },
    })
    if (!resp.ok) {
      const error = new Error(`Graph ${resp.status}: ${(await resp.text()).slice(0, 300)}`) as Error & { status: number }
      error.status = resp.status
      throw error
    }
    const pagina = await resp.json()
    eventos.push(...(pagina.value ?? []))
    url = pagina['@odata.nextLink'] ?? null
  }
  return eventos
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const llave = Deno.env.get('TEAMS_CRON_KEY')
  if (!llave || req.headers.get('x-cron-key') !== llave) return json({ ok: false, message: 'No autorizado' }, 401)

  try {
    const token = await obtenerTokenGraph()
    const personas = await organizadores()
    const resumen: Record<string, number> = {}
    const errores: string[] = []

    for (const persona of personas) {
      let eventos: EventoGraph[]
      try {
        eventos = await eventosDe(token, persona.email)
      } catch (error) {
        const status = (error as { status?: number }).status
        // Sin el permiso Calendars.Read falla con todos: se avisa una vez.
        if (status === 401 || status === 403) {
          return json({ ok: false, message: 'Microsoft Graph negó el acceso a los calendarios: falta el permiso Calendars.Read de aplicación o la política de acceso no incluye a esta persona.', detalle: (error as Error).message }, 502)
        }
        // 404: la persona no tiene buzón en el tenant (p. ej. otra empresa).
        if (status !== 404) errores.push(`${persona.email}: ${(error as Error).message}`)
        continue
      }

      for (const evento of eventos) {
        const esTeams = evento.isOnlineMeeting && evento.onlineMeetingProvider === 'teamsForBusiness'
        const organiza = evento.organizer?.emailAddress.address?.toLowerCase() === persona.email.toLowerCase()
        if (!esTeams || !organiza || evento.sensitivity === 'private' || evento.sensitivity === 'confidential') continue

        const inicio = aIso(evento.start.dateTime)
        const fin = aIso(evento.end.dateTime)
        const { data: resultado, error } = await supabaseAdmin.rpc('registrar_reunion_teams', {
          p_evento_id: evento.iCalUId,
          p_organizador: persona.id,
          p_area: persona.areaId,
          p_titulo: evento.subject ?? '',
          p_descripcion: describir(evento, persona, inicio, fin),
          p_inicio: inicio,
          p_fin: fin,
          p_cancelada: evento.isCancelled,
          p_url: evento.onlineMeeting?.joinUrl ?? null,
        })
        if (error) {
          errores.push(`${evento.subject ?? evento.iCalUId}: ${error.message}`)
          continue
        }
        resumen[resultado as string] = (resumen[resultado as string] ?? 0) + 1
      }
    }

    if (errores.length > 0) console.error('Errores al sincronizar Teams:', errores.slice(0, 20))
    return json({ ok: true, personas: personas.length, resumen, errores: errores.length })
  } catch (error) {
    console.error('Error al sincronizar Teams:', (error as Error).message)
    return json({ ok: false, message: 'Error interno' }, 500)
  }
})
