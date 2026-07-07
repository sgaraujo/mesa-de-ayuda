// Edge Function: send-welcome-email
// Envía un correo de bienvenida (por Microsoft Graph) justo después de que
// alguien termina de crear su contraseña por primera vez. Solo envía si el
// correo corresponde a un perfil real ya existente en la app (evita que
// se use el endpoint para mandar correos a direcciones arbitrarias).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, enviarCorreo } from '../_shared/graph.ts'

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
    const saludo = perfil.full_name?.trim() ? `Hola ${perfil.full_name.trim()},` : 'Hola,'

    try {
      await enviarCorreo(
        correo,
        '¡Bienvenido a Mesa de Ayuda!',
        `
          <p>${saludo}</p>
          <p>Tu cuenta en <strong>Mesa de Ayuda</strong> ya está lista.</p>
          <p>Desde ahí puedes crear solicitudes de trabajo, y si eres agente o admin,
          tomar tareas del tablero, hacerles seguimiento y ver estadísticas del equipo.</p>
          <p><a href="${siteUrl}">Entrar a Mesa de Ayuda</a></p>
        `,
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
