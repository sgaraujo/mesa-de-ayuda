// Edge Function: sincronizar-nelyoda
// Recibe de Nelyoda (Inteegrados) el estado laboral de las personas y lo
// aplica en la Mesa de Ayuda (migración 0034). No la llama ningún usuario: la
// llaman las Cloud Functions de Nelyoda con la clave compartida en el header
// x-sync-key, por eso se despliega con --no-verify-jwt.
//
//   · Vigente sin acceso  → se agrega a la whitelist como solicitante.
//   · Retirado con cuenta → se desactiva y bloquea (como revoke-user, pero sin
//     borrar la whitelist, para poder reactivarla igual que estaba).
//   · Vuelve a vigente    → se reactiva, solo si fue esta sincronización la que
//     la desactivó. Una revocación manual de un admin se respeta.
//   · Los superadmins nunca se desactivan desde aquí: un error de datos en
//     Nelyoda no puede dejar la Mesa de Ayuda sin quien la administre.

import { createClient } from 'npm:@supabase/supabase-js@2'

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const DOMINIOS_PERMITIDOS = ['inteegra.net.co', 'triangulum.net.co', 'netcol.net.co']
// Los filtros .in() viajan en la URL: lotes chicos para no pasar su límite.
const MAX_PERSONAS_POR_LLAMADO = 100
const BLOQUEO_INDEFINIDO = '876000h'

interface RelacionLaboral {
  empresa: string | null
  proyecto: string | null
  area: string | null
  cuentaAnalitica: string | null
  cargo: string | null
  jefe: string | null
}

interface PersonaNelyoda {
  ref: string
  email: string
  nombre: string | null
  telefono: string | null
  activo: boolean
  relaciones: RelacionLaboral[]
}

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

async function claveValida(recibida: string | null): Promise<boolean> {
  const esperada = Deno.env.get('NELYODA_SYNC_KEY')
  if (!esperada || !recibida) return false
  // Se comparan las huellas para que el tiempo no dependa de la clave.
  const codificar = async (valor: string) => new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(valor)),
  )
  const [a, b] = await Promise.all([codificar(recibida), codificar(esperada)])
  let diferencia = 0
  for (let i = 0; i < a.length; i++) diferencia |= a[i] ^ b[i]
  return diferencia === 0
}

const texto = (valor: unknown, max = 200): string | null => {
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  return limpio ? limpio.slice(0, max) : null
}

function normalizarPersona(valor: unknown): PersonaNelyoda | null {
  if (!valor || typeof valor !== 'object') return null
  const p = valor as Record<string, unknown>
  const ref = texto(p.ref, 128)
  const email = texto(p.email, 320)?.toLowerCase() ?? null
  if (!ref || !email || typeof p.activo !== 'boolean') return null
  if (!DOMINIOS_PERMITIDOS.includes(email.split('@')[1] ?? '')) return null

  const relaciones = (Array.isArray(p.relaciones) ? p.relaciones : [])
    .slice(0, 20)
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      empresa: texto(r.empresa),
      proyecto: texto(r.proyecto),
      area: texto(r.area),
      cuentaAnalitica: texto(r.cuentaAnalitica),
      cargo: texto(r.cargo),
      jefe: texto(r.jefe),
    }))

  return {
    ref,
    email,
    nombre: texto(p.nombre),
    telefono: texto(p.telefono, 40),
    activo: p.activo,
    relaciones,
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, message: 'Método no permitido' }, 405)
  if (!(await claveValida(req.headers.get('x-sync-key')))) {
    return json({ ok: false, message: 'No autorizado' }, 401)
  }

  try {
    const cuerpo = await req.json().catch(() => null)
    const recibidas: unknown[] = Array.isArray(cuerpo?.personas) ? cuerpo.personas : []
    if (recibidas.length > MAX_PERSONAS_POR_LLAMADO) {
      return json({ ok: false, message: `Máximo ${MAX_PERSONAS_POR_LLAMADO} personas por llamado` }, 400)
    }

    // Si el mismo correo llega dos veces en el lote, gana la última versión.
    const porEmail = new Map<string, PersonaNelyoda>()
    let ignoradas = 0
    for (const valor of recibidas) {
      const persona = normalizarPersona(valor)
      if (persona) porEmail.set(persona.email, persona)
      else ignoradas++
    }
    let personas = [...porEmail.values()]
    if (personas.length === 0) return json({ ok: true, procesadas: 0, ignoradas })

    // Un correo ya tomado por otro expediente de Nelyoda es un dato duplicado
    // allá: se omite y se reporta en vez de pisar a la otra persona.
    const [porRef, porCorreo] = await Promise.all([
      supabaseAdmin.from('personas_nelyoda').select('ref, email, desactivo_cuenta').in('ref', personas.map((p) => p.ref)),
      supabaseAdmin.from('personas_nelyoda').select('ref, email, desactivo_cuenta').in('email', personas.map((p) => p.email)),
    ])
    if (porRef.error) throw porRef.error
    if (porCorreo.error) throw porCorreo.error
    const existentes = [...(porRef.data ?? []), ...(porCorreo.data ?? [])]
      .map((e) => ({ ...e, email: String(e.email).toLowerCase() }))

    const conflictos = personas.filter((p) => existentes.some((e) => e.email === p.email && e.ref !== p.ref))
    if (conflictos.length > 0) {
      console.warn('Correos repetidos entre expedientes de Nelyoda:', conflictos.map((p) => p.email).join(', '))
      personas = personas.filter((p) => !conflictos.includes(p))
    }
    const desactivadaPorSync = new Set(
      existentes.filter((e) => e.desactivo_cuenta).map((e) => e.ref),
    )

    // desactivo_cuenta no va en el upsert: se conserva y se ajusta más abajo.
    const { error: upsertError } = await supabaseAdmin.from('personas_nelyoda').upsert(
      personas.map((p) => ({
        ref: p.ref,
        email: p.email,
        nombre: p.nombre,
        telefono: p.telefono,
        activo: p.activo,
        relaciones: p.relaciones,
        actualizado_at: new Date().toISOString(),
      })),
      { onConflict: 'ref' },
    )
    if (upsertError) throw upsertError

    const emails = personas.map((p) => p.email)
    const [{ data: perfiles, error: perfilesError }, { data: whitelist, error: whitelistError }] = await Promise.all([
      supabaseAdmin.from('profiles').select('id, email, role, activo, full_name').in('email', emails),
      supabaseAdmin.from('allowed_emails').select('email, role, origen, used_at').in('email', emails),
    ])
    if (perfilesError) throw perfilesError
    if (whitelistError) throw whitelistError

    const perfilPorEmail = new Map((perfiles ?? []).map((p) => [String(p.email).toLowerCase(), p]))
    const whitelistPorEmail = new Map((whitelist ?? []).map((w) => [String(w.email).toLowerCase(), w]))

    const habilitar: string[] = []
    const quitarDeWhitelist: string[] = []
    const desactivar: { id: string; ref: string }[] = []
    const reactivar: { id: string; ref: string }[] = []
    const completarNombre: { id: string; nombre: string }[] = []
    const adminsRetirados: string[] = []

    for (const persona of personas) {
      const perfil = perfilPorEmail.get(persona.email)
      const enWhitelist = whitelistPorEmail.get(persona.email)

      if (perfil && !perfil.full_name?.trim() && persona.nombre) {
        completarNombre.push({ id: perfil.id, nombre: persona.nombre })
      }

      if (persona.activo) {
        // Sin perfil ni whitelist: nunca tuvo acceso. Con perfil y sin
        // whitelist: un admin le revocó el acceso, y eso no se deshace aquí.
        if (!perfil && !enWhitelist) habilitar.push(persona.email)
        if (perfil && !perfil.activo && desactivadaPorSync.has(persona.ref)) {
          reactivar.push({ id: perfil.id, ref: persona.ref })
        }
        continue
      }

      if (perfil?.activo) {
        if (perfil.role === 'admin') adminsRetirados.push(persona.email)
        else desactivar.push({ id: perfil.id, ref: persona.ref })
      }
      if (!perfil && enWhitelist?.origen === 'nelyoda' && !enWhitelist.used_at && enWhitelist.role === 'solicitante') {
        quitarDeWhitelist.push(persona.email)
      }
    }

    if (habilitar.length > 0) {
      const { error } = await supabaseAdmin.from('allowed_emails').upsert(
        habilitar.map((email) => ({ email, role: 'solicitante', origen: 'nelyoda' })),
        { onConflict: 'email', ignoreDuplicates: true },
      )
      if (error) throw error
    }

    if (quitarDeWhitelist.length > 0) {
      const { error } = await supabaseAdmin
        .from('allowed_emails')
        .delete()
        .in('email', quitarDeWhitelist)
        .eq('origen', 'nelyoda')
        .is('used_at', null)
      if (error) throw error
    }

    // Cada cuenta por separado: si una falla, las demás siguen y la marca
    // desactivo_cuenta solo queda en las que de verdad cambiaron.
    const fallidas: string[] = []
    for (const { id, ref } of desactivar) {
      const { error: perfilError } = await supabaseAdmin.from('profiles').update({ activo: false }).eq('id', id)
      if (perfilError) { fallidas.push(ref); continue }
      const { error: bloqueoError } = await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: BLOQUEO_INDEFINIDO })
      if (bloqueoError) {
        await supabaseAdmin.from('profiles').update({ activo: true }).eq('id', id)
        fallidas.push(ref)
        continue
      }
      await supabaseAdmin.from('personas_nelyoda').update({ desactivo_cuenta: true }).eq('ref', ref)
    }

    for (const { id, ref } of reactivar) {
      const { error: desbloqueoError } = await supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: 'none' })
      if (desbloqueoError) { fallidas.push(ref); continue }
      const { error: perfilError } = await supabaseAdmin.from('profiles').update({ activo: true }).eq('id', id)
      if (perfilError) { fallidas.push(ref); continue }
      await supabaseAdmin.from('personas_nelyoda').update({ desactivo_cuenta: false }).eq('ref', ref)
    }

    for (const { id, nombre } of completarNombre) {
      await supabaseAdmin.from('profiles').update({ full_name: nombre }).eq('id', id).is('full_name', null)
    }

    if (adminsRetirados.length > 0) {
      console.warn('Superadmins retirados en Nelyoda (no se desactivan solos):', adminsRetirados.join(', '))
    }

    const resumen = {
      procesadas: personas.length,
      ignoradas,
      conflictos: conflictos.map((p) => p.email),
      habilitadas: habilitar.length,
      quitadasDeWhitelist: quitarDeWhitelist.length,
      desactivadas: desactivar.length - desactivar.filter((d) => fallidas.includes(d.ref)).length,
      reactivadas: reactivar.length - reactivar.filter((r) => fallidas.includes(r.ref)).length,
      adminsRetirados,
    }
    console.log('Sincronización Nelyoda:', JSON.stringify(resumen))

    // 502 para que Nelyoda reintente: todo lo anterior es idempotente.
    if (fallidas.length > 0) return json({ ok: false, ...resumen, fallidas: fallidas.length }, 502)
    return json({ ok: true, ...resumen })
  } catch (error) {
    console.error('Error al sincronizar con Nelyoda:', (error as Error).message)
    return json({ ok: false, message: 'Error interno' }, 500)
  }
})
