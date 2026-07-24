export type Role = 'admin' | 'agente' | 'solicitante'
export type Estado = 'pendiente' | 'en_curso' | 'finalizado'
export type Prioridad = 'baja' | 'media' | 'alta' | 'urgente'

export interface Area {
  id: string
  nombre: string
  orden: number
}

export interface Proyecto {
  id: string
  nombre: string
}

export interface Profile {
  id: string
  email: string
  full_name: string | null
  area_id: string | null
  role: Role
  empresa: string
  created_at: string
}

export interface Ticket {
  id: string
  titulo: string
  descripcion: string
  solicitante_id: string
  empresa_solicitante: string
  asignado_a: string | null
  area_id: string | null
  proyecto_id: string | null
  es_grupal: boolean
  estado: Estado
  prioridad: Prioridad
  created_at: string
  updated_at: string
  finalizado_at: string | null
  fecha_requerida: string | null
  tiempo_propuesto_horas: number | null
  tiempo_ejecutado_horas: number | null
}

export interface TicketConRelaciones extends Ticket {
  solicitante: Pick<Profile, 'id' | 'full_name' | 'email'> | null
  asignado: Pick<Profile, 'id' | 'full_name' | 'email'> | null
  area: Pick<Area, 'id' | 'nombre'> | null
  proyecto: Pick<Proyecto, 'id' | 'nombre'> | null
  asignados: { profile: Pick<Profile, 'id' | 'full_name' | 'email'> }[]
}

export interface TicketStatusHistory {
  id: string
  ticket_id: string
  estado: Estado
  changed_at: string
  changed_by: string | null
}

export interface AllowedEmail {
  email: string
  area_id: string | null
  role: Role
  invited_at: string | null
  used_at: string | null
}
