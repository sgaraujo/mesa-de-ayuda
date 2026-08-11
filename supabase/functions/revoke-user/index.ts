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

    const { email } = await req.json()
    if (typeof email !== 'string' || !email.includes('@')) return json({ ok: false, message: 'Correo inválido' }, 400)
    const correo = email.trim().toLowerCase()

    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .eq('email', correo)
      .maybeSingle()
    if (perfilError) return json({ ok: false, message: 'No se pudo consultar el usuario' }, 500)
    if (!perfil) {
      const { error: eliminarError } = await supabaseAdmin.from('allowed_emails').delete().eq('email', correo)
      if (eliminarError) return json({ ok: false, message: 'No se pudo eliminar el correo' }, 500)
      return json({ ok: true, revoked: false })
    }
    if (perfil.id === authData.user.id) return json({ ok: false, message: 'No puedes revocar tu propio acceso' }, 400)

    const { error: desactivarError } = await supabaseAdmin.from('profiles').update({ activo: false }).eq('id', perfil.id)
    if (desactivarError) return json({ ok: false, message: 'No se pudo desactivar el perfil' }, 500)

    const { error: bloqueoError } = await supabaseAdmin.auth.admin.updateUserById(perfil.id, {
      ban_duration: '876000h',
    })
    if (bloqueoError) {
      await supabaseAdmin.from('profiles').update({ activo: true }).eq('id', perfil.id)
      return json({ ok: false, message: 'No se pudo bloquear la cuenta' }, 500)
    }

    const { error: eliminarError } = await supabaseAdmin.from('allowed_emails').delete().eq('email', correo)
    if (eliminarError) return json({ ok: false, message: 'La cuenta se bloqueó, pero no se pudo eliminar el correo' }, 500)
    return json({ ok: true, revoked: true })
  } catch (error) {
    console.error('Error al revocar usuario:', (error as Error).message)
    return json({ ok: false, message: 'Error interno' }, 500)
  }
})
