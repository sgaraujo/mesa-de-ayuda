// Edge Function: invite-user
// Valida un correo contra la whitelist (allowed_emails) y los 3 dominios
// corporativos permitidos. Si es válido, genera el link de invitación con
// Supabase Auth (sin usar su SMTP) y lo envía por correo usando Microsoft
// Graph API (OAuth2 client credentials) — necesario porque el tenant de
// Microsoft 365 no permite SMTP AUTH básico.
//
// Siempre responde { ok: true } para no revelar por enumeración si un correo
// está o no en la whitelist; solo falla ante errores reales de servidor.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, enviarCorreo } from '../_shared/graph.ts'
import { plantillaCorreo } from '../_shared/email-template.ts'

const DOMINIOS_PERMITIDOS = ['inteegra.net.co', 'triangulum.net.co', 'netcol.net.co']

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
    const dominio = correo.split('@')[1]

    if (!DOMINIOS_PERMITIDOS.includes(dominio)) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: whitelistRow, error: whitelistError } = await supabaseAdmin
      .from('allowed_emails')
      .select('email, used_at')
      .eq('email', correo)
      .maybeSingle()

    if (whitelistError) {
      console.error('Consulta a allowed_emails falló:', whitelistError.message)
      return new Response(
        JSON.stringify({ ok: false, message: 'Error de base de datos: ' + whitelistError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (whitelistRow && !whitelistRow.used_at) {
      const redirectTo = `${Deno.env.get('SITE_URL') ?? ''}/crear-password`

      let { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'invite',
        email: correo,
        options: { redirectTo },
      })

      // Si un intento anterior falló después de crear el usuario en Auth (ej. el
      // correo no llegó), "invite" ya no sirve porque el usuario existe pero está
      // sin confirmar. "magiclink" sí genera un link válido para reenviar en ese caso.
      if (linkError && linkError.message.toLowerCase().includes('already been registered')) {
        console.log('Usuario ya existe sin confirmar, reintentando con magiclink para', correo)
        ;({ data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: 'magiclink',
          email: correo,
          options: { redirectTo },
        }))
      }

      if (linkError) {
        console.error('generateLink falló para', correo, ':', linkError.message)
        return new Response(
          JSON.stringify({ ok: false, message: 'No se pudo generar la invitación: ' + linkError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      const actionLink = linkData?.properties?.action_link
      if (!actionLink) {
        console.error('generateLink no devolvió action_link para', correo)
        return new Response(
          JSON.stringify({ ok: false, message: 'No se pudo generar el link de invitación.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      try {
        console.log('Enviando invitación a', correo, 'vía Microsoft Graph')
        await enviarCorreo(
          correo,
          'Invitación a Mesa de Ayuda',
          plantillaCorreo({
            titulo: 'Te invitaron a Mesa de Ayuda',
            parrafos: [
              'Ya casi quedas dentro. Solo falta que crees tu contraseña para poder entrar a la plataforma de solicitudes y tickets del equipo.',
              'Este enlace es personal y expira después de un tiempo, así que créala pronto.',
            ],
            botonTexto: 'Crear mi contraseña',
            botonUrl: actionLink,
          }),
        )
      } catch (graphErr) {
        console.error('Envío por Graph falló para', correo, ':', (graphErr as Error).message)
        return new Response(
          JSON.stringify({ ok: false, message: 'No se pudo enviar el correo. Intenta más tarde.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      await supabaseAdmin
        .from('allowed_emails')
        .update({ invited_at: new Date().toISOString() })
        .eq('email', correo)
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
