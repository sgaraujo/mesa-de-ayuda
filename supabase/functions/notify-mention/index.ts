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

// Avisa por correo a las personas mencionadas (@) en un comentario. Solo el
// autor del comentario puede dispararlo, y cada mención se envía una sola vez
// (ticket_menciones.notificado_at).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    const { data: authData, error: authError } = token
      ? await supabaseAdmin.auth.getUser(token)
      : { data: { user: null }, error: new Error('Falta autorización') }

    if (authError || !authData.user) return json({ ok: false, message: 'No autorizado' }, 401)

    const { comentarioId } = await req.json()
    if (typeof comentarioId !== 'string') return json({ ok: false, message: 'Datos inválidos' }, 400)

    const { data: comentario, error: comentarioError } = await supabaseAdmin
      .from('ticket_comentarios')
      .select(`
        id, texto, autor_id,
        ticket:tickets!ticket_comentarios_ticket_id_fkey(id, numero, titulo),
        autor:profiles!ticket_comentarios_autor_id_fkey(full_name, email, activo)
      `)
      .eq('id', comentarioId)
      .maybeSingle()
    if (comentarioError || !comentario) return json({ ok: false, message: 'Comentario no encontrado' }, 404)

    const autor = Array.isArray(comentario.autor) ? comentario.autor[0] : comentario.autor
    const ticket = Array.isArray(comentario.ticket) ? comentario.ticket[0] : comentario.ticket
    if (comentario.autor_id !== authData.user.id || !autor || autor.activo === false || !ticket) {
      return json({ ok: false, message: 'No autorizado' }, 403)
    }

    // Reserva atómica: solo se envía a las menciones que nadie notificó aún.
    const { data: reservadas, error: reservaError } = await supabaseAdmin
      .from('ticket_menciones')
      .update({ notificado_at: new Date().toISOString() })
      .eq('comentario_id', comentarioId)
      .is('notificado_at', null)
      .select('profile_id')
    if (reservaError) throw reservaError

    const idsDestinatarios = (reservadas ?? []).map((fila) => fila.profile_id)
    if (idsDestinatarios.length === 0) {
      return json({ ok: false, enviados: 0, detalle: 'No hay menciones pendientes de aviso en este comentario' }, 409)
    }

    const { data: personas, error: personasError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name')
      .in('id', idsDestinatarios)
      .eq('activo', true)
    if (personasError) throw personasError

    const nombreAutor = escaparHtml(autor.full_name?.trim() || autor.email)
    const tituloTicket = escaparHtml(`#${ticket.numero} ${ticket.titulo}`)
    const textoComentario = escaparHtml(comentario.texto).replace(/\n/g, '<br>')
    const siteUrl = Deno.env.get('SITE_URL') ?? ''

    const resultados = await Promise.allSettled((personas ?? []).map(async (persona) => {
      const nombre = escaparHtml(persona.full_name?.trim() || persona.email)
      try {
        await enviarCorreo(
          persona.email,
          `${autor.full_name?.trim() || autor.email} te mencionó en #${ticket.numero}`,
          plantillaCorreo({
            titulo: 'Te mencionaron en una tarea',
            etiqueta: 'Mención',
            preheader: `${autor.full_name?.trim() || autor.email} te mencionó en la tarea #${ticket.numero}.`,
            parrafos: [
              `Hola <strong>${nombre}</strong>, <strong>${nombreAutor}</strong> te mencionó en la tarea <strong>${tituloTicket}</strong>:`,
              `<em>${textoComentario}</em>`,
            ],
            botonTexto: 'Ver la tarea',
            botonUrl: `${siteUrl}/mis-solicitudes?ticket=${ticket.id}`,
          }),
        )
      } catch (error) {
        // Se libera la reserva para poder reintentar el aviso.
        await supabaseAdmin
          .from('ticket_menciones')
          .update({ notificado_at: null })
          .eq('comentario_id', comentarioId)
          .eq('profile_id', persona.id)
        throw error
      }
    }))

    const fallidos = resultados.filter((resultado): resultado is PromiseRejectedResult => resultado.status === 'rejected')
    fallidos.forEach((resultado) => console.error('Notificación de mención falló:', resultado.reason))
    const enviados = resultados.length - fallidos.length
    if (fallidos.length > 0) {
      // El motivo se devuelve a quien comentó (es una app interna) para que
      // sepa por qué no salió el correo.
      const motivo = fallidos[0].reason
      const detalle = (motivo instanceof Error ? motivo.message : String(motivo)).slice(0, 300)
      return json({ ok: false, enviados, fallidos: fallidos.length, detalle }, 502)
    }
    return json({ ok: true, enviados })
  } catch (error) {
    const detalle = error instanceof Error ? error.message : JSON.stringify(error)
    console.error('Error al notificar mención:', detalle)
    return json({ ok: false, message: 'Error interno', detalle: detalle.slice(0, 300) }, 500)
  }
})
