import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/graph.ts'

// Asistente para redactar solicitudes con Gemini (la misma API key que usa
// Nelyoda, secreto GEMINI_API_KEY). A partir del borrador propone un título
// claro, una descripción ordenada y las preguntas que el equipo haría si falta
// información. No guarda nada: la persona decide si usa la propuesta.
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash'
const TEXTO_MAX_CARACTERES = 5000

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const INSTRUCCIONES = `Eres el asistente de la Mesa de Ayuda interna de un grupo de empresas colombianas.
Ayudas a una persona a redactar una solicitud de trabajo para otra área, para que el equipo entienda
qué necesita sin tener que preguntar.

Con el borrador que recibes:
- "titulo": un título corto y concreto (máximo 100 caracteres) que diga qué se necesita.
- "descripcion": la misma solicitud, más clara y ordenada, en español neutro y en primera persona
  (como si la escribiera quien pide). Usa estas secciones en texto plano, cada una con su
  encabezado en una línea propia y omitiendo las que no apliquen:
  "Qué necesito:", "Para qué:", "Detalles:", "Se considera listo cuando:".
  No inventes datos (fechas, cifras, nombres, sistemas): usa solo lo que dice el borrador.
- "preguntas": hasta 4 preguntas cortas sobre la información importante que falta para poder
  atender la solicitud. Lista vacía si el borrador ya es suficiente.

Responde solo con el JSON pedido.`

const ESQUEMA_RESPUESTA = {
  type: 'OBJECT',
  properties: {
    titulo: { type: 'STRING' },
    descripcion: { type: 'STRING' },
    preguntas: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['titulo', 'descripcion', 'preguntas'],
}

interface Propuesta {
  titulo: string
  descripcion: string
  preguntas: string[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    const { data: authData, error: authError } = token
      ? await supabaseAdmin.auth.getUser(token)
      : { data: { user: null }, error: new Error('Falta autorización') }
    if (authError || !authData.user) return json({ ok: false, message: 'No autorizado' }, 401)

    if (!GEMINI_API_KEY) return json({ ok: false, message: 'El asistente no está configurado' }, 503)

    const { titulo, descripcion, area, tipo } = await req.json()
    if (typeof titulo !== 'string' || typeof descripcion !== 'string') {
      return json({ ok: false, message: 'Datos inválidos' }, 400)
    }
    if (titulo.trim() === '' && descripcion.trim() === '') {
      return json({ ok: false, message: 'Escribe primero un borrador' }, 400)
    }
    if (titulo.length + descripcion.length > TEXTO_MAX_CARACTERES) {
      return json({ ok: false, message: `El texto supera ${TEXTO_MAX_CARACTERES} caracteres` }, 413)
    }

    const borrador = [
      typeof area === 'string' && area ? `Área destino: ${area}` : null,
      typeof tipo === 'string' && tipo ? `Tipo de solicitud: ${tipo}` : null,
      `Título: ${titulo.trim() || '(sin título)'}`,
      `Descripción:\n${descripcion.trim() || '(sin descripción)'}`,
    ].filter(Boolean).join('\n')

    const respuesta = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: INSTRUCCIONES }] },
          contents: [{ role: 'user', parts: [{ text: borrador }] }],
          generationConfig: {
            temperature: 0.4,
            responseMimeType: 'application/json',
            responseSchema: ESQUEMA_RESPUESTA,
          },
        }),
      },
    )
    if (respuesta.status === 429) return json({ ok: false, message: 'El asistente está ocupado, intenta en un momento' }, 429)
    if (!respuesta.ok) {
      console.error('Gemini respondió', respuesta.status, await respuesta.text())
      return json({ ok: false, message: 'El asistente no respondió' }, 502)
    }

    const datos = await respuesta.json()
    const texto = datos?.candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof texto !== 'string') return json({ ok: false, message: 'El asistente no devolvió una propuesta' }, 502)

    const propuesta = JSON.parse(texto) as Propuesta
    return json({
      ok: true,
      titulo: String(propuesta.titulo ?? '').trim().slice(0, 140),
      descripcion: String(propuesta.descripcion ?? '').trim(),
      preguntas: Array.isArray(propuesta.preguntas) ? propuesta.preguntas.map(String).slice(0, 4) : [],
    })
  } catch (error) {
    console.error('Error en el asistente de solicitudes:', (error as Error).message)
    return json({ ok: false, message: 'Error inesperado' }, 500)
  }
})
