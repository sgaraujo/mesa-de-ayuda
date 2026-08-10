// Genera un enlace de recuperación para usuarios existentes y lo envía por
// Microsoft Graph. La respuesta no revela si el correo está registrado.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, enviarCorreo } from '../_shared/graph.ts'
import { plantillaCorreo } from '../_shared/email-template.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const respuestaOk = () => new Response(JSON.stringify({ ok: true }), {
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const { email } = await req.json()
    if (typeof email !== 'string' || !email.includes('@')) return respuestaOk()

    const correo = email.trim().toLowerCase()
    const { data: perfil, error: perfilError } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('email', correo)
      .maybeSingle()

    if (perfilError || !perfil) {
      if (perfilError) console.error('Consulta de perfil falló:', perfilError.message)
      return respuestaOk()
    }

    const redirectTo = `${Deno.env.get('SITE_URL') ?? ''}/restablecer-password`
    const { data, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: correo,
      options: { redirectTo },
    })

    const actionLink = data?.properties?.action_link
    if (linkError || !actionLink) {
      console.error('No se pudo generar el enlace de recuperación:', linkError?.message)
      return respuestaOk()
    }

    try {
      await enviarCorreo(
        correo,
        'Restablece tu contraseña — Mesa de Ayuda',
        plantillaCorreo({
          titulo: 'Restablece tu contraseña',
          etiqueta: 'Seguridad de la cuenta',
          preheader: 'Usa este enlace para crear una nueva contraseña de acceso.',
          parrafos: [
            'Recibimos una solicitud para cambiar la contraseña de tu cuenta en la <strong>Mesa de Ayuda de Transformación Digital</strong>.',
          ],
          botonTexto: 'Crear nueva contraseña',
          botonUrl: actionLink,
          parrafosPie: [
            'Este enlace es personal y expira después de un tiempo. Si no solicitaste el cambio, ignora este correo; tu contraseña actual seguirá funcionando.',
          ],
        }),
      )
    } catch (errorCorreo) {
      console.error('No se pudo enviar la recuperación para', correo, ':', (errorCorreo as Error).message)
    }

    return respuestaOk()
  } catch (error) {
    console.error('Error interno en reset-password:', (error as Error).message)
    return respuestaOk()
  }
})
