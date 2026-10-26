import { supabase } from './supabase'

// Adjuntos de comentarios. La misma lista se valida en comentar_ticket()
// (migración 0029): si cambia aquí, cambia allá.
export const ARCHIVO_COMENTARIO_EXTENSIONES = ['doc', 'docx', 'xls', 'xlsx', 'pdf', 'jpg', 'jpeg', 'png', 'zip']
export const ARCHIVO_COMENTARIO_MAX_MB = 10
export const ARCHIVOS_POR_COMENTARIO = 10

const BUCKET = 'ticket-imagenes'
const EXTENSIONES_IMAGEN = ['png', 'jpg', 'jpeg', 'webp', 'gif']

export function extensionDe(nombreArchivo: string): string {
  return nombreArchivo.includes('.') ? nombreArchivo.split('.').pop()!.toLowerCase() : ''
}

export function esImagen(nombreArchivo: string): boolean {
  return EXTENSIONES_IMAGEN.includes(extensionDe(nombreArchivo))
}

export function pesoLegible(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Devuelve por qué no se puede adjuntar el archivo, o null si se puede.
export function validarArchivoComentario(archivo: File): string | null {
  if (!ARCHIVO_COMENTARIO_EXTENSIONES.includes(extensionDe(archivo.name))) {
    return `"${archivo.name}" no es un tipo permitido (Word, Excel, PDF, JPG, PNG o ZIP).`
  }
  if (archivo.size === 0) return `"${archivo.name}" está vacío.`
  if (archivo.size > ARCHIVO_COMENTARIO_MAX_MB * 1024 * 1024) {
    return `"${archivo.name}" pesa más de ${ARCHIVO_COMENTARIO_MAX_MB} MB.`
  }
  return null
}

export interface ArchivoSubido {
  ruta: string
  nombre: string
  tamano: number
  tipo: string
}

// Sube el archivo a la carpeta de la tarea; el registro en ticket_archivos lo
// hace comentar_ticket() al publicar el comentario.
export async function subirArchivoComentario(ticketId: string, archivo: File): Promise<ArchivoSubido> {
  const ruta = `comentarios/${ticketId}/${crypto.randomUUID()}.${extensionDe(archivo.name)}`
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, archivo, { contentType: archivo.type || undefined })
  if (error) throw error
  return { ruta, nombre: archivo.name, tamano: archivo.size, tipo: archivo.type }
}

// Adjuntos al crear una solicitud. La misma lista se valida en
// adjuntar_archivos_solicitud() (migración 0040): si cambia aquí, cambia allá.
export const ARCHIVO_SOLICITUD_EXTENSIONES = [
  'png', 'jpg', 'jpeg', 'webp', 'gif',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip',
]
export const ARCHIVO_SOLICITUD_MAX_MB = 10
export const ARCHIVOS_POR_SOLICITUD = 10

export async function subirArchivoSolicitud(ticketId: string, archivo: File): Promise<ArchivoSubido> {
  const ruta = `solicitudes/${ticketId}/${crypto.randomUUID()}.${extensionDe(archivo.name)}`
  const { error } = await supabase.storage.from(BUCKET).upload(ruta, archivo, { contentType: archivo.type || undefined })
  if (error) throw error
  return { ruta, nombre: archivo.name, tamano: archivo.size, tipo: archivo.type }
}

export function urlArchivo(ruta: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl
}

// Fuerza la descarga con el nombre original (en el bucket se guarda con un uuid).
export function urlDescarga(ruta: string, nombre: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(ruta, { download: nombre }).data.publicUrl
}
