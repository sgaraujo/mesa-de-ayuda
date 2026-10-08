import type { Profile } from '../types/database'

export function nombreDe(persona: Pick<Profile, 'full_name' | 'email'>): string {
  return persona.full_name?.trim() || persona.email
}

// Al enviar solo cuentan las personas elegidas en el autocompletado que siguen
// escritas en el texto (si borraron el "@Nombre", ya no se las menciona).
export function mencionadosEnTexto<T extends Pick<Profile, 'full_name' | 'email'>>(texto: string, mencionados: T[]): T[] {
  return mencionados.filter((m) => texto.includes(`@${nombreDe(m)}`))
}
