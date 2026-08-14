// Edge Function: admin-set-password
// Permite que un admin le asigne o restablezca la contraseña a una persona de
// la whitelist directamente, sin depender de que le llegue un correo (invitación,
// bienvenida o recuperación) por Microsoft Graph. Útil cuando el envío de
// correos falla o mientras se diagnostica.
//
// Si la persona ya tiene cuenta (profiles), le actualiza la contraseña. Si
// todavía no la tiene, la crea ya confirmada con esa contraseña.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/graph.ts'

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

    const { data: admin } = await supabaseAdmin
      .from('profiles')
      .select('role, activo')
      .eq('id', authData.user.id)
      .maybeSingle()
    if (admin?.role !== 'admin' || admin.activo === false) return json({ ok: false, message: 'No autorizado' }, 403)

    const { email, password } = await req.json()
    if (typeof email !== 'string' || !email.includes('@')) return json({ ok: false, message: 'Correo inválido' }, 400)
    if (typeof password !== 'string' || password.length < 8) {
      return json({ ok: false, message: 'La contraseña debe tener al menos 8 caracteres.' }, 400)
    }

    const correo = email.trim().toLowerCase()

    const { data: whitelistRow, error: whitelistError } = await supabaseAdmin
      .from('allowed_emails')
      .select('email')
      .eq('email', correo)
      .maybeSingle()
    if (whitelistError) return json({ ok: false, message: 'Error de base de datos: ' + whitelistError.message }, 500)
    if (!whitelistRow) return json({ ok: false, message: 'Ese correo no está en la whitelist.' }, 404)

    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', correo)
      .maybeSingle()
    if (perfilError) return json({ ok: false, message: 'Error de base de datos: ' + perfilError.message }, 500)

    if (perfil) {
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(perfil.id, {
        password,
        email_confirm: true,
      })
      if (updateError) {
        return json({ ok: false, message: 'No se pudo asignar la contraseña: ' + updateError.message }, 500)
      }
    } else {
      const { error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: correo,
        password,
        email_confirm: true,
      })
      if (createError) {
        return json({ ok: false, message: 'No se pudo crear la cuenta: ' + createError.message }, 500)
      }
    }

    return json({ ok: true })
  } catch (error) {
    console.error('Error en admin-set-password:', (error as Error).message)
    return json({ ok: false, message: 'Error interno' }, 500)
  }
})
