export function dominioDeCorreo(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? ''
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
