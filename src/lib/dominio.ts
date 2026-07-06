import { DOMINIOS_PERMITIDOS } from '../types/database'

export function dominioDeCorreo(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? ''
}

export function esDominioPermitido(email: string): boolean {
  const dominio = dominioDeCorreo(email)
  return (DOMINIOS_PERMITIDOS as readonly string[]).includes(dominio)
}

export function nombreEmpresa(email: string): string {
  const dominio = dominioDeCorreo(email)
  const nombres: Record<string, string> = {
    'inteegra.net.co': 'Inteegra',
    'triangulum.net.co': 'Triangulum',
    'netcol.net.co': 'Netcol',
  }
  return nombres[dominio] ?? dominio
}
