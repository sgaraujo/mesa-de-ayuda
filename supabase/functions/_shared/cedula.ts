// Cuentas de quien entra con cédula y no tiene correo corporativo en Nelyoda
// (migración 0035). Su correo es interno y estable, derivado de la huella de
// la cédula (personas_nelyoda.ref); no existe y nunca se le envía nada.

export const DOMINIO_SIN_CORREO = 'cedula.local'

export const correoInterno = (ref: string) => `cc-${ref.slice(0, 24)}@${DOMINIO_SIN_CORREO}`

export const esCorreoInterno = (correo: string) => correo.toLowerCase().endsWith(`@${DOMINIO_SIN_CORREO}`)
