// Rol en profiles / whitelist. 'admin' es el superadmin (ve todas las áreas);
// 'lider' y 'agente' definen además la primera membresía del área indicada.
export type Role = 'admin' | 'lider' | 'agente' | 'solicitante'
// Rol dentro de un área (area_miembros).
export type RolArea = 'lider' | 'agente'
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
  area_id: string
}

export interface AreaMiembro {
  area_id: string
  profile_id: string
  rol: RolArea
  created_at: string
}

export interface Profile {
  id: string
  email: string
  full_name: string | null
  area_id: string | null
  role: Role
  activo: boolean
  empresa: string
  created_at: string
}

export interface Ticket {
  id: string
  numero: number
  titulo: string
  descripcion: string
  solicitante_id: string
  empresa_solicitante: string
  asignado_a: string | null
  area_id: string
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
  archivo_url: string | null
  nota_finalizacion: string | null
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

// Historial de ediciones de un ticket (lo llenan triggers, ver migración 0024).
export interface TicketCambio {
  id: number
  ticket_id: string
  campo: string
  valor_anterior: string | null
  valor_nuevo: string | null
  changed_by: string | null
  changed_at: string
}

export interface AllowedEmail {
  email: string
  area_id: string | null
  role: Role
  invited_at: string | null
  used_at: string | null
}
