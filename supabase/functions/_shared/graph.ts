// Envío de correo por Microsoft Graph API (OAuth2 client credentials).
// Se usa porque el tenant de Microsoft 365 no permite SMTP AUTH básico,
// así que no se puede usar el SMTP nativo de Supabase Auth.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

export async function enviarCorreo(destino: string, asunto: string, htmlBody: string) {
  const token = await obtenerTokenGraph()

  const resp = await fetch(`${MS_GRAPH_URL}/users/${MS_SENDER_UPN}/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: asunto,
        body: { contentType: 'HTML', content: htmlBody },
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
