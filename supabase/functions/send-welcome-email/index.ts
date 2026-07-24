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
        '¡Bienvenido a Mesa de Ayuda!',
        plantillaCorreo({
          titulo: 'Tu cuenta ya está lista',
          etiqueta: 'Bienvenido al equipo',
          preheader: 'Ya puedes ingresar, crear solicitudes y hacer seguimiento desde Mesa de Ayuda.',
          parrafos: [
            `${saludo} activamos correctamente tu acceso a <strong>Mesa de Ayuda</strong>. Ya puedes ingresar y empezar a trabajar desde un solo lugar.`,
          ],
          items: [
            '<strong>Crea solicitudes</strong> y consulta su estado en cualquier momento.',
            '<strong>Haz seguimiento</strong> a las tareas y tiempos de ejecución.',
            '<strong>Colabora con el equipo</strong> desde el tablero según tu rol.',
          ],
          botonTexto: 'Ingresar a Mesa de Ayuda',
          botonUrl: siteUrl,
        }),
      )
    } catch (graphErr) {
      console.error('Envío del correo de bienvenida falló para', correo, ':', (graphErr as Error).message)
      return new Response(JSON.stringify({ ok: false, message: 'No se pudo enviar el correo.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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
