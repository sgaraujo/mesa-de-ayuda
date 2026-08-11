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
      .select('id, role, activo')
      .eq('id', authData.user.id)
      .maybeSingle()
    if (!remitente || remitente.activo === false) {
      return json({ ok: false, message: 'No autorizado' }, 403)
    }

    const { ticketId, agentesIds, tipo } = await req.json()
    const esNuevaTarea = tipo === 'nueva'
    if (typeof ticketId !== 'string' || (!esNuevaTarea && !Array.isArray(agentesIds))) {
      return json({ ok: false, message: 'Datos inválidos' }, 400)
    }

    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('tickets')
      .select('id, solicitante_id, asignado_a, es_grupal')
      .eq('id', ticketId)
      .maybeSingle()
    if (ticketError || !ticket) return json({ ok: false, message: 'Tarea no encontrada' }, 404)

    let consultaAgentes = supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, role, activo')
      .in('role', ['admin', 'agente'])
      .eq('activo', true)

    if (esNuevaTarea) {
      if (ticket.solicitante_id !== remitente.id || ticket.asignado_a !== null || ticket.es_grupal) {
        return json({ ok: false, message: 'No autorizado' }, 403)
      }
    } else {
      if (!['admin', 'agente'].includes(remitente.role)) {
        return json({ ok: false, message: 'No autorizado' }, 403)
      }

      const idsSolicitados = [...new Set(
        agentesIds.filter((id): id is string => typeof id === 'string' && id.length > 0),
      )]
      if (idsSolicitados.length === 0) return json({ ok: true, enviados: 0 })

      let idsAsignados: string[] = ticket.asignado_a ? [ticket.asignado_a] : []
      if (ticket.es_grupal) {
        const { data: asignados, error: asignadosError } = await supabaseAdmin
          .from('ticket_asignados')
          .select('profile_id')
          .eq('ticket_id', ticketId)
        if (asignadosError) return json({ ok: false, message: 'No se pudo validar la asignación' }, 500)
        idsAsignados = (asignados ?? []).map((fila) => fila.profile_id)
      }

      const destinatariosIds = idsSolicitados.filter((id) => idsAsignados.includes(id))
      if (destinatariosIds.length === 0) return json({ ok: true, enviados: 0 })
      consultaAgentes = consultaAgentes.in('id', destinatariosIds)
    }

    const { data: agentes, error: agentesError } = await consultaAgentes
    if (agentesError) return json({ ok: false, message: 'No se pudieron consultar los agentes' }, 500)

    const siteUrl = Deno.env.get('SITE_URL') ?? ''
    const resultados = await Promise.allSettled((agentes ?? []).map(async (agente) => {
      const tipoNotificacion = esNuevaTarea ? 'nueva' : 'asignacion'
      const { error: reservaError } = await supabaseAdmin
        .from('ticket_email_notifications')
        .insert({
          ticket_id: ticketId,
          recipient_id: agente.id,
          notification_type: tipoNotificacion,
        })

      // La llave primaria impide repetir el mismo aviso para una persona.
      if (reservaError?.code === '23505') return { enviado: false, duplicado: true }
      if (reservaError) throw reservaError

      const nombre = agente.full_name?.trim()
        ? escaparHtml(agente.full_name.trim())
        : escaparHtml(agente.email)
      try {
        await enviarCorreo(
          agente.email,
          esNuevaTarea ? 'Hay una nueva tarea en la bandeja' : 'Tienes una nueva tarea asignada',
          plantillaCorreo({
            titulo: esNuevaTarea ? 'Nueva tarea en la bandeja' : 'Te asignaron una nueva tarea',
            etiqueta: esNuevaTarea ? 'Nueva solicitud' : 'Nueva asignación',
            preheader: esNuevaTarea
              ? 'Hay una nueva tarea pendiente de asignación en la Mesa de Ayuda.'
              : 'Tienes una nueva tarea asignada en la Mesa de Ayuda.',
            parrafos: [
              esNuevaTarea
                ? `Hola <strong>${nombre}</strong>, se creó una nueva tarea y está disponible en la bandeja general.`
                : `Hola <strong>${nombre}</strong>, se te asignó una nueva tarea en la Mesa de Ayuda.`,
              'Ingresa al tablero para consultar la información y gestionar la tarea.',
            ],
            botonTexto: 'Ver tarea en el tablero',
            botonUrl: `${siteUrl}/tablero`,
          }),
        )
        return { enviado: true, duplicado: false }
      } catch (error) {
        await supabaseAdmin
          .from('ticket_email_notifications')
          .delete()
          .eq('ticket_id', ticketId)
          .eq('recipient_id', agente.id)
          .eq('notification_type', tipoNotificacion)
        throw error
      }
    }))

    const fallidos = resultados.filter((resultado) => resultado.status === 'rejected')
    if (fallidos.length > 0) {
      fallidos.forEach((resultado) => {
        if (resultado.status === 'rejected') console.error('Notificación de asignación falló:', resultado.reason)
      })
      const enviados = resultados.filter((resultado) => (
        resultado.status === 'fulfilled' && resultado.value.enviado
      )).length
      return json({ ok: false, enviados, fallidos: fallidos.length }, 502)
    }

    const enviados = resultados.filter((resultado) => (
      resultado.status === 'fulfilled' && resultado.value.enviado
    )).length
    return json({ ok: true, enviados })
  } catch (error) {
    console.error('Error al notificar asignación:', (error as Error).message)
    return json({ ok: false, message: 'Error interno' }, 500)
  }
})
