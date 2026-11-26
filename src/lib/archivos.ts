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

// Nombre del archivo apto para una ruta de Storage, que solo admite un juego
// reducido de caracteres: sin tildes ni eñes y con "_" en lugar de espacios y
// símbolos. Así, si alguien abre el archivo en una pestaña y lo guarda desde
// el navegador, conserva un nombre reconocible.
function nombreParaRuta(nombreArchivo: string): string {
  const extension = extensionDe(nombreArchivo)
  const base = (extension ? nombreArchivo.slice(0, -(extension.length + 1)) : nombreArchivo)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 100)
  return `${base || 'archivo'}${extension ? `.${extension}` : ''}`
}

// Carpeta con uuid (las rutas deben ser únicas) y dentro el archivo con su
// nombre. Las anteriores quedaron como <uuid>.<ext> y siguen funcionando.
function rutaArchivo(carpeta: string, ticketId: string, archivo: File): string {
  return `${carpeta}/${ticketId}/${crypto.randomUUID()}/${nombreParaRuta(archivo.name)}`
}

// Sube el archivo a la carpeta de la tarea; el registro en ticket_archivos lo
// hace comentar_ticket() al publicar el comentario.
export async function subirArchivoComentario(ticketId: string, archivo: File): Promise<ArchivoSubido> {
  const ruta = rutaArchivo('comentarios', ticketId, archivo)
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
  const ruta = rutaArchivo('solicitudes', ticketId, archivo)
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

// Descarga el archivo con su nombre original. El ?download= de urlDescarga
// depende del encabezado que arma Storage, que con tildes, eñes o espacios no
// siempre respeta el nombre, y el atributo download de un <a> se ignora entre
// dominios. Por eso se baja como blob y se guarda desde la propia app.
export async function descargarConNombre(url: string, nombre: string): Promise<void> {
  const respuesta = await fetch(url)
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`)
  const blob = await respuesta.blob()
  const enlace = document.createElement('a')
  enlace.href = URL.createObjectURL(blob)
  enlace.download = nombre
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  // Se libera después: revocarla en el mismo tick cancela la descarga en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(enlace.href), 10_000)
}
