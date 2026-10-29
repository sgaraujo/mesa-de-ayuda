// Edge Function: notify-eliminacion
// Correo a quien creó una tarea y a sus responsables cuando el líder del área
// la elimina con un motivo (migración 0054). La llama el cliente justo
// después de eliminar_ticket(), con el id del registro en tickets_eliminados.

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

    const { eliminadoId } = await req.json()
    if (typeof eliminadoId !== 'string') return json({ ok: false, message: 'Datos inválidos' }, 400)

    // Se marca antes de enviar: si dos llamados llegan juntos, solo uno pasa.
    // Solo quien eliminó la tarea puede disparar el aviso.
    const { data: registro, error: registroError } = await supabaseAdmin
      .from('tickets_eliminados')
      .update({ correo_enviado_at: new Date().toISOString() })
      .eq('id', eliminadoId)
      .eq('eliminado_por', authData.user.id)
      .is('correo_enviado_at', null)
      .select('numero, titulo, motivo, notificados, area:areas(nombre), eliminador:profiles!tickets_eliminados_eliminado_por_fkey(full_name, email)')
      .maybeSingle()
    if (registroError) throw registroError
    if (!registro) return json({ ok: true, enviados: 0 })

    const notificados = (registro.notificados ?? []) as string[]
    if (notificados.length === 0) return json({ ok: true, enviados: 0 })

    const { data: personas, error: personasError } = await supabaseAdmin
      .from('profiles')
      .select('email, full_name')
      .in('id', notificados)
      .eq('activo', true)
    if (personasError) throw personasError

    const uno = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)
    const eliminador = uno(registro.eliminador) as { full_name: string | null; email: string } | null
    const area = uno(registro.area) as { nombre: string } | null
    const quien = escaparHtml(eliminador?.full_name?.trim() || eliminador?.email || 'El líder del área')
    const tarea = `#${registro.numero} ${escaparHtml(registro.titulo)}`

    let enviados = 0
    for (const persona of personas ?? []) {
      const nombre = escaparHtml(persona.full_name?.trim() || persona.email)
      try {
        await enviarCorreo(
          persona.email,
          `Se eliminó la tarea #${registro.numero}`,
          plantillaCorreo({
            titulo: 'Se eliminó una tarea',
            etiqueta: 'Tarea eliminada',
            preheader: `La tarea "${registro.titulo}" fue eliminada.`,
            parrafos: [
              `Hola <strong>${nombre}</strong>, <strong>${quien}</strong> eliminó la tarea <strong>${tarea}</strong>${area ? ` de ${escaparHtml(area.nombre)}` : ''}.`,
              `Motivo: <em>${escaparHtml(registro.motivo)}</em>`,
              'La tarea ya no aparece en la Mesa de Ayuda. Si todavía la necesitas, crea una nueva solicitud.',
            ],
          }),
        )
        enviados++
      } catch (error) {
        // Uno que falle no impide avisar a los demás; la campanita ya quedó.
        console.error('No se pudo enviar el aviso de eliminación:', (error as Error).message)
      }
    }

    return json({ ok: true, enviados })
  } catch (error) {
    console.error('Error al notificar la eliminación:', (error as Error).message)
    return json({ ok: false, message: 'Error interno' }, 500)
  }
})
