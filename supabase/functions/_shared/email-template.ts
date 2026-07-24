// Plantilla compatible con Outlook y Gmail: tablas y estilos inline.
const VERDE_MARCA = '#008300'
const FONDO_PAGINA = '#f4f4f2'
const TEXTO_PRIMARIO = '#0b0b0b'
const TEXTO_SECUNDARIO = '#3d3d3a'
const TEXTO_MUTED = '#77756f'

interface PlantillaCorreoOptions {
  titulo: string
  parrafos: string[]
  botonTexto?: string
  botonUrl?: string
  preheader?: string
  etiqueta?: string
  items?: string[]
}

export function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (caracter) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[caracter]!)
}

export function plantillaCorreo({ titulo, parrafos, botonTexto, botonUrl, preheader, etiqueta, items = [] }: PlantillaCorreoOptions): string {
  const parrafosHtml = parrafos
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${TEXTO_SECUNDARIO};">${p}</p>`)
    .join('')

  const itemsHtml = items.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;background-color:#f6faf6;border:1px solid #dcebdc;border-radius:10px;">
        ${items.map((item, indice) => `<tr>
          <td width="36" valign="top" style="padding:13px 0 13px 16px;color:${VERDE_MARCA};font-size:16px;font-weight:700;">&#10003;</td>
          <td style="padding:13px 16px 13px 0;color:${TEXTO_SECUNDARIO};font-size:14px;line-height:1.45;${indice < items.length - 1 ? 'border-bottom:1px solid #dcebdc;' : ''}">${item}</td>
        </tr>`).join('')}
      </table>`
    : ''

  const botonHtml = botonUrl
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;"><tr>
        <td align="center" style="border-radius:8px;background-color:${VERDE_MARCA};">
          <a href="${botonUrl}" style="display:block;padding:14px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;font-family:'Segoe UI',Arial,sans-serif;">${botonTexto ?? 'Continuar'}</a>
        </td>
      </tr></table>
      <p style="margin:16px 0 0;font-size:11px;line-height:1.5;color:${TEXTO_MUTED};word-break:break-all;">
        Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
        <a href="${botonUrl}" style="color:${VERDE_MARCA};text-decoration:underline;">${botonUrl}</a>
      </p>`
    : ''

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${titulo}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${FONDO_PAGINA};font-family:'Segoe UI',Arial,sans-serif;-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader ?? titulo}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${FONDO_PAGINA};">
      <tr><td align="center" style="padding:40px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border:1px solid #e5e5e1;border-radius:14px;max-width:560px;width:100%;">
          <tr><td style="background-color:${VERDE_MARCA};padding:24px 36px;border-radius:14px 14px 0 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td width="42"><div style="width:36px;height:36px;line-height:36px;text-align:center;border-radius:9px;background:#ffffff;color:${VERDE_MARCA};font-size:20px;font-weight:800;">M</div></td>
              <td style="color:#ffffff;font-size:18px;font-weight:700;">Mesa de Ayuda</td>
              <td align="right" style="color:#dff1df;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Portal de solicitudes</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:38px 36px 32px;">
            ${etiqueta ? `<p style="margin:0 0 10px;color:${VERDE_MARCA};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">${etiqueta}</p>` : ''}
            <h1 style="margin:0 0 18px;font-size:26px;line-height:1.25;color:${TEXTO_PRIMARIO};font-family:'Segoe UI',Arial,sans-serif;">${titulo}</h1>
            ${parrafosHtml}${itemsHtml}${botonHtml}
          </td></tr>
          <tr><td style="padding:22px 36px;border-top:1px solid #eeeeea;background-color:#fafaf8;border-radius:0 0 14px 14px;">
            <p style="margin:0;font-size:12px;line-height:1.5;color:${TEXTO_MUTED};">Este es un mensaje automático de Mesa de Ayuda. Si no esperabas este correo, puedes ignorarlo.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}
