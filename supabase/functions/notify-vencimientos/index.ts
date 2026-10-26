// Edge Function: notify-vencimientos
// La llama pg_cron cada 15 minutos (migración 0041) con el header
// x-cron-key = secreto VENCIMIENTOS_CRON_KEY; se despliega con
// --no-verify-jwt. revisar_vencimientos() registra las alertas nuevas y crea
// las notificaciones de la campanita; aquí solo se envían los correos.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, enviarCorreo } from '../_shared/graph.ts'
import { escaparHtml, plantillaCorreo } from '../_shared/email-template.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

type TipoAlerta = '24h' | '4h' | 'vencido'

interface Alerta {
  ticket_id: string
  tipo: TipoAlerta
  fecha_objetivo: string
}

interface Persona {
  id: string
  email: string
  full_name: string | null
  activo: boolean
}

const ASUNTO: Record<TipoAlerta, string> = {
  '24h': 'Una tarea vence en menos de 24 horas',
  '4h': 'Una tarea vence en menos de 4 horas',
  vencido: 'Una tarea está vencida',
}

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    dateStyle: 'long',
    timeStyle: 'short',
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const llave = Deno.env.get('VENCIMIENTOS_CRON_KEY')
  if (!llave || req.headers.get('x-cron-key') !== llave) return json({ ok: false, message: 'No autorizado' }, 401)

  try {
    const { data: alertas, error } = await supabaseAdmin.rpc('revisar_vencimientos')
    if (error) throw error
    if (!alertas || alertas.length === 0) return json({ ok: true, alertas: 0, enviados: 0 })

    const siteUrl = Deno.env.get('SITE_URL') ?? ''
    let enviados = 0

    for (const alerta of alertas as Alerta[]) {
      const { data: ticket } = await supabaseAdmin
        .from('tickets')
        .select(`
          id, numero, titulo, area_id, asignado_a,
          solicitante:profiles!tickets_solicitante_id_fkey(id, email, full_name, activo),
          asignado:profiles!tickets_asignado_a_fkey(id, email, full_name, activo),
          asignados:ticket_asignados(profile:profiles(id, email, full_name, activo))
        `)
        .eq('id', alerta.ticket_id)
        .maybeSingle()
      if (!ticket) continue

      const uno = <T>(valor: T | T[] | null): T | null => (Array.isArray(valor) ? valor[0] ?? null : valor)
      const solicitante = uno(ticket.solicitante as Persona | Persona[] | null)
      let responsables: Persona[] = [
        uno(ticket.asignado as Persona | Persona[] | null),
        ...((ticket.asignados ?? []) as { profile: Persona | Persona[] | null }[]).map((a) => uno(a.profile)),
      ].filter((p): p is Persona => !!p)

      // Sin responsables: les llega a los líderes del área (igual que la campanita).
      if (responsables.length === 0) {
        const { data: lideres } = await supabaseAdmin
          .from('area_miembros')
          .select('profile:profiles(id, email, full_name, activo)')
          .eq('area_id', ticket.area_id)
          .eq('rol', 'lider')
        responsables = (lideres ?? []).map((l) => uno(l.profile as Persona | Persona[] | null)).filter((p): p is Persona => !!p)
      }

      const destinatarios = new Map<string, { persona: Persona; esSolicitante: boolean }>()
      for (const persona of responsables) destinatarios.set(persona.id, { persona, esSolicitante: false })
      if (solicitante) destinatarios.set(solicitante.id, { persona: solicitante, esSolicitante: true })

      const vencida = alerta.tipo === 'vencido'
      const fecha = formatearFecha(alerta.fecha_objetivo)
      const tarea = `<strong>#${ticket.numero} ${escaparHtml(ticket.titulo)}</strong>`

      for (const { persona, esSolicitante } of destinatarios.values()) {
        if (!persona.activo) continue
        const nombre = escaparHtml(persona.full_name?.trim() || persona.email)
        try {
          await enviarCorreo(
            persona.email,
            ASUNTO[alerta.tipo],
            plantillaCorreo({
              titulo: vencida ? 'Tarea vencida' : 'Tarea próxima a vencer',
              etiqueta: vencida ? 'Vencida' : alerta.tipo === '4h' ? 'Vence en menos de 4 h' : 'Vence en menos de 24 h',
              preheader: `${ticket.titulo}: ${vencida ? 'venció' : 'vence'} el ${fecha}.`,
              parrafos: [
                `Hola <strong>${nombre}</strong>, ${esSolicitante ? 'tu solicitud' : 'la tarea'} ${tarea} ${vencida ? 'venció' : 'vence'} el <strong>${fecha}</strong> y todavía no está finalizada.`,
                esSolicitante
                  ? 'El equipo que la atiende también recibió este aviso.'
                  : vencida
                    ? 'Finalízala o, si necesitas más tiempo, acuerda una nueva fecha compromiso con quien la pidió.'
                    : 'Revisa si alcanzas a terminarla a tiempo o ajusta la fecha compromiso.',
              ],
              botonTexto: 'Ver la tarea',
              botonUrl: esSolicitante ? `${siteUrl}/mis-solicitudes?ticket=${ticket.id}` : siteUrl,
            }),
          )
          enviados++
        } catch (errorCorreo) {
          console.error('No se pudo enviar el aviso de vencimiento a', persona.email, ':', (errorCorreo as Error).message)
        }
      }
    }

    return json({ ok: true, alertas: alertas.length, enviados })
  } catch (error) {
    console.error('Error al revisar vencimientos:', (error as Error).message)
    return json({ ok: false, message: 'Error interno' }, 500)
  }
})
