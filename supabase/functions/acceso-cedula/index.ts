// Edge Function: acceso-cedula
// Ingreso a la Mesa de Ayuda con cédula y código de un solo uso, para quien
// no tiene correo corporativo (o no lo recuerda). Pública: la llama la página
// /ingreso-cedula con la anon key.
//
//   { accion: 'solicitar', cedula }          → Nelyoda envía el código
//   { accion: 'verificar', cedula, codigo }  → Nelyoda lo valida y aquí se
//                                              crea (si hace falta) la cuenta y
//                                              se devuelve un token de sesión
//
// Nelyoda (ticketBoardIdentity) guarda y verifica el código y limita los
// envíos por cédula; aquí se limitan las solicitudes por IP (accesos_cedula).
// El correo y el celular personales nunca llegan a ticket-board.
//
// La cuenta usa el correo corporativo si la persona lo tiene en Nelyoda (es la
// misma cuenta de siempre) o, si no, un correo interno derivado de la cédula
// (_shared/cedula.ts). Entra como solicitante salvo que ya tuviera otro rol.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/graph.ts'
import { correoInterno, esCorreoInterno } from '../_shared/cedula.ts'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const MAX_POR_IP_HORA = 60

interface PersonaVerificada {
  ref: string
  nombre: string | null
  emailCorporativo: string | null
  telefono: string | null
  relaciones: { empresa: string | null }[]
}

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

async function preguntarANelyoda(cuerpo: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resp = await fetch(Deno.env.get('NELYODA_IDENTITY_URL')!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sync-key': Deno.env.get('NELYODA_SYNC_KEY')! },
    body: JSON.stringify(cuerpo),
  })
  const datos = await resp.json().catch(() => ({}))
  if (resp.status >= 500 || resp.status === 401) throw new Error(`Nelyoda respondió ${resp.status}`)
  return datos
}

async function excedeLimiteIp(ip: string): Promise<boolean> {
  const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count } = await supabaseAdmin
    .from('accesos_cedula')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', haceUnaHora)
  if ((count ?? 0) >= MAX_POR_IP_HORA) return true
  await supabaseAdmin.from('accesos_cedula').insert({ ip })
  // Limpieza ocasional: el límite solo mira la última hora.
  if (Math.random() < 0.02) {
    await supabaseAdmin.from('accesos_cedula').delete().lt('created_at', new Date(Date.now() - 86400000).toISOString())
  }
  return false
}

/** Devuelve el id del perfil activo de la persona, creándolo si no existe. */
async function cuentaDe(persona: PersonaVerificada): Promise<{ id: string } | { motivo: string }> {
  const correo = persona.emailCorporativo ?? correoInterno(persona.ref)

  const buscar = () => supabaseAdmin
    .from('profiles')
    .select('id, activo, full_name')
    .eq('email', correo)
    .maybeSingle()

  let { data: perfil, error } = await buscar()
  if (error) throw error

  if (!perfil) {
    // El trigger de auth.users crea el perfil (solicitante salvo que la
    // whitelist diga otra cosa).
    const { error: crearError } = await supabaseAdmin.auth.admin.createUser({ email: correo, email_confirm: true })
    if (crearError && !crearError.message.toLowerCase().includes('already')) throw crearError
    ;({ data: perfil, error } = await buscar())
    if (error) throw error
    if (!perfil) throw new Error('No se creó el perfil')

    const cambios: Record<string, string> = {}
    if (persona.nombre) cambios.full_name = persona.nombre
    if (esCorreoInterno(correo)) cambios.empresa = persona.relaciones[0]?.empresa ?? 'Sin correo corporativo'
    if (Object.keys(cambios).length > 0) await supabaseAdmin.from('profiles').update(cambios).eq('id', perfil.id)
  } else if (!perfil.activo) {
    return { motivo: 'desactivado' }
  } else if (!perfil.full_name && persona.nombre) {
    await supabaseAdmin.from('profiles').update({ full_name: persona.nombre }).eq('id', perfil.id)
  }

  // Datos de directorio (cargo, área) para quien no tiene correo corporativo;
  // a los demás ya los trae la sincronización.
  if (esCorreoInterno(correo)) {
    await supabaseAdmin.from('personas_nelyoda').upsert({
      ref: persona.ref,
      email: correo,
      nombre: persona.nombre,
      telefono: persona.telefono,
      activo: true,
      relaciones: persona.relaciones,
      actualizado_at: new Date().toISOString(),
    }, { onConflict: 'ref' })
  }

  return { id: perfil.id }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ ok: false, motivo: 'metodo' }, 405)

  try {
    const { accion, cedula, codigo } = await req.json().catch(() => ({}))
    const cedulaLimpia = String(cedula ?? '').replace(/\D/g, '')
    if (cedulaLimpia.length < 5 || cedulaLimpia.length > 12) return json({ ok: false, motivo: 'cedula_invalida' })

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'desconocida'
    if (await excedeLimiteIp(ip)) return json({ ok: false, motivo: 'limite_ip' }, 429)

    if (accion === 'solicitar') {
      return json(await preguntarANelyoda({ accion: 'solicitar', cedula: cedulaLimpia }))
    }

    if (accion !== 'verificar') return json({ ok: false, motivo: 'accion_invalida' }, 400)

    const codigoLimpio = String(codigo ?? '').replace(/\D/g, '')
    if (codigoLimpio.length !== 6) return json({ ok: false, motivo: 'codigo_invalido' })

    const verificacion = await preguntarANelyoda({ accion: 'verificar', cedula: cedulaLimpia, codigo: codigoLimpio })
    if (!verificacion.ok) return json(verificacion)

    const cuenta = await cuentaDe(verificacion.persona as PersonaVerificada)
    if ('motivo' in cuenta) return json({ ok: false, motivo: cuenta.motivo })

    // El link no se envía a nadie: el cliente canjea el token con verifyOtp.
    const { data: usuario } = await supabaseAdmin.auth.admin.getUserById(cuenta.id)
    const { data: enlace, error: enlaceError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: usuario.user!.email!,
    })
    if (enlaceError || !enlace.properties?.hashed_token) throw enlaceError ?? new Error('Sin token de sesión')

    return json({ ok: true, tokenHash: enlace.properties.hashed_token })
  } catch (error) {
    console.error('Error en ingreso por cédula:', (error as Error).message)
    return json({ ok: false, motivo: 'error' }, 500)
  }
})
