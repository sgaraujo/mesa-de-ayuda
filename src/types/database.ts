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

// Catálogo de tipos de solicitud por área (migración 0031).
export interface TipoSolicitud {
  id: string
  area_id: string
  nombre: string
  orden: number
  activo: boolean
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
  // Tarea de la que se duplicó esta (migración 0028).
  duplicado_de: string | null
  // Solo en áreas con catálogo de tipos (migración 0031).
  tipo_id: string | null
  // Respuesta de quien pidió la tarea a su finalización (migración 0032). En
  // una tarea finalizada, null = por aprobar; 'rechazada' sigue en la tarea
  // reabierta hasta que la vuelvan a finalizar.
  aprobacion: Aprobacion | null
  aprobacion_at: string | null
}

export type Aprobacion = 'aprobada' | 'rechazada'

export interface TicketConRelaciones extends Ticket {
  solicitante: Pick<Profile, 'id' | 'full_name' | 'email'> | null
  asignado: Pick<Profile, 'id' | 'full_name' | 'email'> | null
  area: Pick<Area, 'id' | 'nombre'> | null
  proyecto: Pick<Proyecto, 'id' | 'nombre'> | null
  tipo: Pick<TipoSolicitud, 'id' | 'nombre'> | null
  asignados: { profile: Pick<Profile, 'id' | 'full_name' | 'email'> }[]
  // Solo lo trae el tablero (conteo agregado de ticket_comentarios).
  comentarios?: { count: number }[]
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

// Comentarios de un ticket y sus menciones (@), ver migración 0025.
export interface TicketComentario {
  id: string
  ticket_id: string
  autor_id: string | null
  texto: string
  created_at: string
}

// Archivos adjuntos en comentarios (migración 0029). El adjunto de la
// creación sigue en tickets.archivo_url.
export interface TicketArchivo {
  id: string
  ticket_id: string
  comentario_id: string | null
  subido_por: string | null
  ruta: string
  nombre: string
  tamano: number
  tipo: string | null
  created_at: string
}

export interface TicketMencion {
  comentario_id: string
  ticket_id: string
  profile_id: string
  notificado_at: string | null
}

// Centro de notificaciones (migración 0026); las crean triggers.
export type TipoNotificacion = 'mencion' | 'comentario' | 'asignacion' | 'estado' | 'aprobacion' | 'rechazo'

export interface Notificacion {
  id: string
  destinatario_id: string
  tipo: TipoNotificacion
  ticket_id: string
  comentario_id: string | null
  actor_id: string | null
  detalle: string | null
  leida_at: string | null
  created_at: string
}

export interface AllowedEmail {
  email: string
  area_id: string | null
  role: Role
  invited_at: string | null
  used_at: string | null
  origen: 'manual' | 'nelyoda'
}

// Relación laboral vigente según Nelyoda (migración 0034).
export interface RelacionLaboralNelyoda {
  empresa: string | null
  proyecto: string | null
  area: string | null
  cuentaAnalitica: string | null
  cargo: string | null
  jefe: string | null
}

export interface PersonaNelyoda {
  ref: string
  email: string
  nombre: string | null
  telefono: string | null
  activo: boolean
  relaciones: RelacionLaboralNelyoda[]
  desactivo_cuenta: boolean
  actualizado_at: string
}
