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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    const { data: authData, error: authError } = token
      ? await supabaseAdmin.auth.getUser(token)
      : { data: { user: null }, error: new Error('Falta autorización') }

    if (authError || !authData.user) return json({ ok: false, message: 'No autorizado' }, 401)

    const { data: remitente } = await supabaseAdmin
      .from('profiles')
      .select('role, activo')
      .eq('id', authData.user.id)
      .maybeSingle()
    if (!remitente || remitente.activo === false || !['admin', 'agente'].includes(remitente.role)) {
      return json({ ok: false, message: 'No autorizado' }, 403)
    }

    const { ticketId } = await req.json()
    if (typeof ticketId !== 'string') return json({ ok: false, message: 'Datos inválidos' }, 400)

    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('tickets')
      .select('id, titulo, estado, nota_finalizacion, solicitante:profiles!tickets_solicitante_id_fkey(id, email, full_name, activo)')
      .eq('id', ticketId)
      .maybeSingle()
    if (ticketError || !ticket) return json({ ok: false, message: 'Tarea no encontrada' }, 404)
    if (ticket.estado !== 'finalizado') return json({ ok: false, message: 'La tarea no está finalizada' }, 409)

    const solicitante = Array.isArray(ticket.solicitante) ? ticket.solicitante[0] : ticket.solicitante
    if (!solicitante || solicitante.activo === false) return json({ ok: true, enviados: 0 })

    const { error: reservaError } = await supabaseAdmin
      .from('ticket_email_notifications')
      .insert({
        ticket_id: ticketId,
        recipient_id: solicitante.id,
        notification_type: 'finalizado',
      })

    // La llave primaria impide repetir el aviso para la misma tarea.
    if (reservaError?.code === '23505') return json({ ok: true, enviados: 0 })
    if (reservaError) throw reservaError

    const nombre = solicitante.full_name?.trim()
      ? escaparHtml(solicitante.full_name.trim())
      : escaparHtml(solicitante.email)
    const nota = ticket.nota_finalizacion?.trim()

    try {
      const siteUrl = Deno.env.get('SITE_URL') ?? ''
      await enviarCorreo(
        solicitante.email,
        'Tu solicitud fue finalizada',
        plantillaCorreo({
          titulo: 'Tu solicitud fue finalizada',
          etiqueta: 'Solicitud finalizada',
          preheader: `La tarea "${ticket.titulo}" fue marcada como finalizada.`,
          parrafos: [
            `Hola <strong>${nombre}</strong>, tu solicitud <strong>${escaparHtml(ticket.titulo)}</strong> fue marcada como finalizada.`,
            ...(nota ? [`Nota de quien la finalizó: <em>${escaparHtml(nota)}</em>`] : []),
            'Ingresa al tablero si quieres revisar el detalle.',
          ],
          botonTexto: 'Ver en el tablero',
          botonUrl: `${siteUrl}/tablero`,
        }),
      )
    } catch (error) {
      await supabaseAdmin
        .from('ticket_email_notifications')
        .delete()
        .eq('ticket_id', ticketId)
        .eq('recipient_id', solicitante.id)
        .eq('notification_type', 'finalizado')
      throw error
    }

    return json({ ok: true, enviados: 1 })
  } catch (error) {
    console.error('Error al notificar finalización:', (error as Error).message)
    return json({ ok: false, message: 'Error interno' }, 500)
  }
})
