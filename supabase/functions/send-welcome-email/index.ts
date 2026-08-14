// Edge Function: send-welcome-email
// Envía un correo de bienvenida (por Microsoft Graph) justo después de que
// alguien termina de crear su contraseña por primera vez. Solo envía si el
// correo corresponde a un perfil real ya existente en la app (evita que
// se use el endpoint para mandar correos a direcciones arbitrarias).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, enviarCorreo } from '../_shared/graph.ts'
import { escaparHtml, plantillaCorreo } from '../_shared/email-template.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { email } = await req.json()

    if (typeof email !== 'string' || !email.includes('@')) {
      return new Response(JSON.stringify({ ok: false, message: 'Correo inválido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const correo = email.trim().toLowerCase()

    const authorization = req.headers.get('Authorization')
    const token = authorization?.replace(/^Bearer\s+/i, '')
    const { data: authData, error: authError } = token
      ? await supabaseAdmin.auth.getUser(token)
      : { data: { user: null }, error: new Error('Falta autorización') }

    if (authError || !authData.user?.email) {
      return new Response(JSON.stringify({ ok: false, message: 'No autorizado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const correoSolicitante = authData.user.email.toLowerCase()
    if (correoSolicitante !== correo) {
      const { data: perfilSolicitante } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', authData.user.id)
        .maybeSingle()

      if (perfilSolicitante?.role !== 'admin') {
        return new Response(JSON.stringify({ ok: false, message: 'No autorizado' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from('profiles')
      .select('email, full_name')
      .eq('email', correo)
      .maybeSingle()

    if (perfilError) {
      console.error('Consulta a profiles falló:', perfilError.message)
      return new Response(JSON.stringify({ ok: false, message: 'Error de base de datos' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Sin perfil real: no enviamos nada, pero respondemos ok para no dar pistas.
    if (!perfil) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const siteUrl = Deno.env.get('SITE_URL') ?? ''
    const nombre = perfil.full_name?.trim() ? escaparHtml(perfil.full_name.trim()) : null
    const saludo = nombre ? `Hola <strong>${nombre}</strong>,` : 'Hola,'

    try {
      await enviarCorreo(
        correo,
        '¡Bienvenido a la Mesa de Ayuda de Transformación Digital!',
        plantillaCorreo({
          titulo: 'Mesa de Ayuda de Transformación Digital',
          etiqueta: 'Bienvenido',
          preheader: 'Ya puedes enviar solicitudes al equipo de Transformación Digital y hacerles seguimiento.',
          parrafos: [
            `${saludo} te damos la bienvenida a la <strong>Mesa de Ayuda de Transformación Digital</strong>. Desde esta aplicación puedes registrar las tareas y solicitudes que requieran la atención de nuestro equipo.`,
            'Todas las solicitudes que registres por este medio serán recibidas y gestionadas por el <strong>equipo de Transformación Digital</strong>.',
          ],
          items: [
            '<strong>Envía tus tareas y solicitudes</strong> al equipo de Transformación Digital.',
            '<strong>Haz seguimiento</strong> a las tareas y tiempos de ejecución.',
            '<strong>Consulta el avance</strong> de cada solicitud desde el tablero.',
          ],
          botonTexto: 'Ingresar a la Mesa de Ayuda',
          botonUrl: siteUrl,
        }),
      )
    } catch (graphErr) {
      console.error('Envío del correo de bienvenida falló para', correo, ':', (graphErr as Error).message)
      return new Response(
        JSON.stringify({ ok: false, message: `No se pudo enviar el correo: ${(graphErr as Error).message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (_err) {
    return new Response(JSON.stringify({ ok: false, message: 'Error interno' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
