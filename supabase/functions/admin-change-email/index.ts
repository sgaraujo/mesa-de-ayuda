// Edge Function: admin-change-email
// Cambia el correo de una persona de la whitelist (por ejemplo, cuando le
// cambian el correo corporativo). Si ya tiene cuenta, cambia también su
// correo de inicio de sesión en Supabase Auth, ya confirmado: la contraseña,
// las áreas, los roles y todas sus tareas se conservan porque cuelgan de su
// id, no del correo. Solo el superadmin puede usarla.
//
// Después avisa por correo: al nuevo, cómo entrar desde ahora; al anterior
// (solo si ya tenía cuenta), un aviso de seguridad. Si el envío falla el
// cambio igual queda hecho y la respuesta lo indica en avisoCorreo.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, enviarCorreo } from '../_shared/graph.ts'
import { escaparHtml, plantillaCorreo } from '../_shared/email-template.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Mismos dominios que nombreEmpresa() en src/lib/dominio.ts.
const DOMINIOS_PERMITIDOS = ['inteegra.net.co', 'triangulum.net.co', 'netcol.net.co']

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

    const { emailActual, emailNuevo } = await req.json()
    if (typeof emailActual !== 'string' || typeof emailNuevo !== 'string') {
      return json({ ok: false, message: 'Datos inválidos' }, 400)
    }

    const actual = emailActual.trim().toLowerCase()
    const nuevo = emailNuevo.trim().toLowerCase()

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevo)) {
      return json({ ok: false, message: 'El correo nuevo no es válido.' }, 400)
    }
    if (!DOMINIOS_PERMITIDOS.includes(nuevo.split('@')[1])) {
      return json({ ok: false, message: `El correo debe ser de ${DOMINIOS_PERMITIDOS.join(', ')}.` }, 400)
    }
    if (nuevo === actual) return json({ ok: false, message: 'El correo nuevo es igual al actual.' }, 400)

    const [{ data: filaActual, error: errorActual }, { data: filaNueva }, { data: perfilNuevo }] = await Promise.all([
      supabaseAdmin.from('allowed_emails').select('email').eq('email', actual).maybeSingle(),
      supabaseAdmin.from('allowed_emails').select('email').eq('email', nuevo).maybeSingle(),
      supabaseAdmin.from('profiles').select('id').eq('email', nuevo).maybeSingle(),
    ])
    if (errorActual) return json({ ok: false, message: 'Error de base de datos: ' + errorActual.message }, 500)
    if (!filaActual) return json({ ok: false, message: 'Ese correo no está en la whitelist.' }, 404)
    if (filaNueva || perfilNuevo) {
      return json({ ok: false, message: `${nuevo} ya está registrado. Usa otro correo o elimina primero ese acceso.` }, 409)
    }

    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name')
      .eq('email', actual)
      .maybeSingle()
    if (perfilError) return json({ ok: false, message: 'Error de base de datos: ' + perfilError.message }, 500)

    // 1. Correo de inicio de sesión (solo si ya creó su cuenta).
    if (perfil) {
      const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(perfil.id, {
        email: nuevo,
        email_confirm: true,
      })
      if (authUpdateError) {
        return json({ ok: false, message: 'No se pudo cambiar el correo de inicio de sesión: ' + authUpdateError.message }, 500)
      }
    }

    // 2. Whitelist y perfil. Si falla, se devuelve el correo de Auth para no
    //    dejar la cuenta a medio cambiar.
    const { error: rpcError } = await supabaseAdmin.rpc('cambiar_correo_persona', {
      p_actual: actual,
      p_nuevo: nuevo,
      p_profile_id: perfil?.id ?? null,
    })
    if (rpcError) {
      if (perfil) {
        await supabaseAdmin.auth.admin.updateUserById(perfil.id, { email: actual, email_confirm: true })
      }
      return json({ ok: false, message: 'No se pudo actualizar la whitelist: ' + rpcError.message }, 500)
    }

    // 3. Avisos por correo (no deshacen el cambio si fallan).
    const siteUrl = Deno.env.get('SITE_URL') ?? ''
    const saludo = perfil?.full_name?.trim()
      ? `Hola <strong>${escaparHtml(perfil.full_name.trim())}</strong>,`
      : 'Hola,'
    const envios: Promise<void>[] = [
      enviarCorreo(
        nuevo,
        'Tu correo de acceso a la Mesa de Ayuda cambió',
        plantillaCorreo({
          titulo: 'Tu correo de acceso cambió',
          etiqueta: 'Cuenta actualizada',
          preheader: `Desde ahora tu acceso a la Mesa de Ayuda es ${nuevo}.`,
          parrafos: perfil
            ? [
                `${saludo} un administrador actualizó tu correo de acceso a la Mesa de Ayuda.`,
                `Desde ahora inicia sesión con <strong>${escaparHtml(nuevo)}</strong> y tu <strong>misma contraseña</strong>. Tus áreas, solicitudes y tareas se conservan.`,
              ]
            : [
                `${saludo} un administrador actualizó el correo con el que tienes acceso a la Mesa de Ayuda.`,
                `Ahora tu acceso está asociado a <strong>${escaparHtml(nuevo)}</strong>. Solicita tu acceso con este correo para crear tu contraseña.`,
              ],
          parrafosPie: [`Correo anterior: ${escaparHtml(actual)}. Si no esperabas este cambio, avísale a un administrador.`],
          botonTexto: perfil ? 'Iniciar sesión' : 'Solicitar acceso',
          botonUrl: `${siteUrl}${perfil ? '/login' : '/solicitar-acceso'}`,
        }),
      ),
    ]
    if (perfil) {
      envios.push(enviarCorreo(
        actual,
        'Tu acceso a la Mesa de Ayuda pasó a otro correo',
        plantillaCorreo({
          titulo: 'Tu acceso pasó a otro correo',
          etiqueta: 'Aviso de seguridad',
          preheader: 'Un administrador cambió el correo de tu cuenta de la Mesa de Ayuda.',
          parrafos: [
            `${saludo} un administrador cambió el correo de tu cuenta de la Mesa de Ayuda.`,
            `Desde ahora inicias sesión con <strong>${escaparHtml(nuevo)}</strong>; este correo (${escaparHtml(actual)}) ya no da acceso.`,
          ],
          parrafosPie: ['Si no esperabas este cambio, avísale de inmediato a un administrador.'],
        }),
      ))
    }

    const resultados = await Promise.allSettled(envios)
    const fallidos = resultados.flatMap((resultado, indice) => (
      resultado.status === 'rejected' ? [{ destino: indice === 0 ? nuevo : actual, motivo: resultado.reason }] : []
    ))
    fallidos.forEach(({ destino, motivo }) => console.error(`Aviso de cambio de correo a ${destino} falló:`, motivo))

    return json({
      ok: true,
      tieneCuenta: Boolean(perfil),
      avisoCorreo: fallidos.length === 0
        ? 'enviado'
        : `No se pudo enviar el aviso a ${fallidos.map((f) => f.destino).join(' ni a ')}`,
    })
  } catch (error) {
    console.error('Error en admin-change-email:', (error as Error).message)
    return json({ ok: false, message: 'Error interno' }, 500)
  }
})
