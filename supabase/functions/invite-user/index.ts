// Edge Function: invite-user
// Valida un correo contra la whitelist (allowed_emails) y los 3 dominios
// corporativos permitidos, y si es válido envía la invitación de Supabase Auth
// (el usuario recibe un correo con link para crear su contraseña).
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

    const { data: whitelistRow } = await supabaseAdmin
      .from('allowed_emails')
      .select('email, used_at')
      .eq('email', correo)
      .maybeSingle()

    if (whitelistRow && !whitelistRow.used_at) {
      const redirectTo = `${Deno.env.get('SITE_URL') ?? ''}/crear-password`
      console.log('Invitando a', correo, 'con redirectTo =', redirectTo)
      const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(correo, {
        redirectTo,
      })

      if (inviteError) {
        console.error('inviteUserByEmail failed for', correo, ':', inviteError.message)
        return new Response(
          JSON.stringify({ ok: false, message: 'No se pudo enviar la invitación. Intenta más tarde.' }),
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
