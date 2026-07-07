// Plantilla base para los correos transaccionales de Mesa de Ayuda.
// Usa tablas + estilos inline (no flexbox/grid) a propósito: es lo único
// que Outlook de escritorio renderiza de forma consistente.

const VERDE_MARCA = '#008300'
const FONDO_PAGINA = '#f4f4f2'
const TEXTO_PRIMARIO = '#0b0b0b'
const TEXTO_SECUNDARIO = '#3d3d3a'
const TEXTO_MUTED = '#898781'

interface PlantillaCorreoOptions {
  titulo: string
  parrafos: string[]
  botonTexto?: string
  botonUrl?: string
}

export function plantillaCorreo({ titulo, parrafos, botonTexto, botonUrl }: PlantillaCorreoOptions): string {
  const parrafosHtml = parrafos
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${TEXTO_SECUNDARIO};">${p}</p>`,
    )
    .join('')

  const botonHtml = botonUrl
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;">
        <tr>
          <td style="border-radius:8px;background-color:${VERDE_MARCA};">
            <a href="${botonUrl}"
               style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;
                      color:#ffffff;text-decoration:none;font-family:'Segoe UI',Arial,sans-serif;">
              ${botonTexto ?? 'Continuar'}
            </a>
          </td>
        </tr>
      </table>
    `
    : ''

  return `
<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background-color:${FONDO_PAGINA};font-family:'Segoe UI',Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${FONDO_PAGINA};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;max-width:480px;width:100%;">
            <tr>
              <td style="background-color:${VERDE_MARCA};padding:20px 32px;border-radius:12px 12px 0 0;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;font-family:'Segoe UI',Arial,sans-serif;">
                  Mesa de Ayuda
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;color:${TEXTO_PRIMARIO};font-family:'Segoe UI',Arial,sans-serif;">
                  ${titulo}
                </h1>
                ${parrafosHtml}
                ${botonHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 24px;">
                <p style="margin:0;font-size:12px;color:${TEXTO_MUTED};">
                  Si no esperabas este correo, puedes ignorarlo.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `
}
