import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/graph.ts'

// Revisión ortográfica y gramatical en español con LanguageTool. Por defecto
// usa la API pública gratuita (~20 revisiones/min compartidas por todos los
// usuarios, porque salen desde esta función). Para el plan pago o un servidor
// propio: LANGUAGETOOL_URL, LANGUAGETOOL_USERNAME y LANGUAGETOOL_API_KEY.
const LANGUAGETOOL_URL = Deno.env.get('LANGUAGETOOL_URL') ?? 'https://api.languagetool.org'
const LANGUAGETOOL_USERNAME = Deno.env.get('LANGUAGETOOL_USERNAME')
const LANGUAGETOOL_API_KEY = Deno.env.get('LANGUAGETOOL_API_KEY')
const TEXTO_MAX_CARACTERES = 5000

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

interface CoincidenciaLanguageTool {
  message: string
  offset: number
  length: number
  replacements: { value: string }[]
  rule: { id: string; issueType?: string }
}

function tipoDeError(issueType: string | undefined): 'ortografia' | 'gramatica' | 'estilo' {
  if (issueType === 'misspelling') return 'ortografia'
  if (issueType === 'style' || issueType === 'register' || issueType === 'locale-violation') return 'estilo'
  // grammar, typographical, uncategorized (p. ej. «haber» por «a ver»), etc.
  return 'gramatica'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    const { data: authData, error: authError } = token
      ? await supabaseAdmin.auth.getUser(token)
      : { data: { user: null }, error: new Error('Falta autorización') }
    if (authError || !authData.user) return json({ ok: false, message: 'No autorizado' }, 401)

    const { texto } = await req.json()
    if (typeof texto !== 'string') return json({ ok: false, message: 'Datos inválidos' }, 400)
    if (texto.trim() === '') return json({ ok: true, sugerencias: [] })
    if (texto.length > TEXTO_MAX_CARACTERES) {
      return json({ ok: false, message: `El texto supera ${TEXTO_MAX_CARACTERES} caracteres` }, 413)
    }

    const parametros = new URLSearchParams({ text: texto, language: 'es', motherTongue: 'es' })
    if (LANGUAGETOOL_USERNAME && LANGUAGETOOL_API_KEY) {
      parametros.set('username', LANGUAGETOOL_USERNAME)
      parametros.set('apiKey', LANGUAGETOOL_API_KEY)
    }

    const respuesta = await fetch(`${LANGUAGETOOL_URL}/v2/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: parametros,
    })
    if (respuesta.status === 429) return json({ ok: false, message: 'Límite de revisiones alcanzado' }, 429)
    if (!respuesta.ok) return json({ ok: false, message: 'El servicio de revisión no respondió' }, 502)

    const { matches } = await respuesta.json() as { matches: CoincidenciaLanguageTool[] }
    const sugerencias = matches.map((m) => ({
      inicio: m.offset,
      largo: m.length,
      fragmento: texto.slice(m.offset, m.offset + m.length),
      mensaje: m.message,
      reemplazos: m.replacements.slice(0, 4).map((r) => r.value),
      regla: m.rule.id,
      tipo: tipoDeError(m.rule.issueType),
    }))

    return json({ ok: true, sugerencias })
  } catch (_err) {
    return json({ ok: false, message: 'Error inesperado' }, 500)
  }
})
