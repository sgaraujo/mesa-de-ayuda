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

const DOMINIOS_PERMITIDOS = ['inteegra.net.co', 'triangulum.net.co', 'netcol.net.co']

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const MS_CLIENT_ID = Deno.env.get('MS_CLIENT_ID')!
const MS_CLIENT_SECRET = Deno.env.get('MS_CLIENT_SECRET')!
const MS_TENANT_ID = Deno.env.get('MS_TENANT_ID')!
const MS_AUTHORITY = Deno.env.get('MS_AUTHORITY') ?? `https://login.microsoftonline.com/${MS_TENANT_ID}`
const MS_SCOPES = Deno.env.get('MS_SCOPES') ?? 'https://graph.microsoft.com/.default'
const MS_GRAPH_URL = Deno.env.get('MS_GRAPH_URL') ?? 'https://graph.microsoft.com/v1.0'
// Buzón desde el que se envían los correos (necesita permiso Mail.Send de aplicación en Graph)
const MS_SENDER_UPN = Deno.env.get('MS_SENDER_UPN')!

async function obtenerTokenGraph(): Promise<string> {
  const resp = await fetch(`${MS_AUTHORITY}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      scope: MS_SCOPES,
      grant_type: 'client_credentials',
    }),
  })

  const data = await resp.json()
  if (!resp.ok) {
    throw new Error(`No se pudo obtener token de Microsoft Graph: ${JSON.stringify(data)}`)
  }
  return data.access_token as string
}

async function enviarCorreoInvitacion(destino: string, linkInvitacion: string) {
  const token = await obtenerTokenGraph()

  const resp = await fetch(`${MS_GRAPH_URL}/users/${MS_SENDER_UPN}/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: 'Invitación a Mesa de Ayuda',
        body: {
          contentType: 'HTML',
          content: `
            <p>Te invitaron a Mesa de Ayuda.</p>
            <p><a href="${linkInvitacion}">Haz clic aquí para crear tu contraseña</a></p>
            <p>Si no esperabas este correo, puedes ignorarlo.</p>
          `,
        },
        toRecipients: [{ emailAddress: { address: destino } }],
      },
      saveToSentItems: false,
    }),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`Graph sendMail falló (${resp.status}): ${errText}`)
  }
}

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

      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'invite',
        email: correo,
        options: { redirectTo },
      })

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
        await enviarCorreoInvitacion(correo, actionLink)
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
