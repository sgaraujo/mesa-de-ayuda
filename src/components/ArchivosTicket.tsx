import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { esImagen, pesoLegible, urlArchivo, urlDescarga } from '../lib/archivos'
import { nombreDe } from '../lib/menciones'
import { IconoArchivo, IconoDescarga } from './ArchivoAdjunto'
import type { Profile, TicketArchivo, TicketConRelaciones } from '../types/database'

type ArchivoConRelaciones = TicketArchivo & {
  autor: Pick<Profile, 'id' | 'full_name' | 'email'> | null
  comentario: { texto: string } | null
}

// Fila ya lista para mostrar: sale de ticket_archivos o del adjunto de la
// creación (tickets.archivo_url).
interface FilaArchivo {
  id: string
  nombre: string
  url: string
  urlDescarga: string
  tamano: number | null
  autor: string
  fecha: string
  origen: string
}

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}

function extracto(texto: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  return limpio.length > 90 ? `${limpio.slice(0, 90)}…` : limpio
}

// El adjunto de la creación se guardó con un uuid como nombre; se muestra con
// uno legible conservando la extensión.
function filaAdjuntoInicial(ticket: TicketConRelaciones): FilaArchivo | null {
  if (!ticket.archivo_url) return null
  const extension = ticket.archivo_url.split('?')[0].split('.').pop()?.toLowerCase()
  const nombre = `Adjunto de la solicitud #${ticket.numero}${extension ? `.${extension}` : ''}`
  const separador = ticket.archivo_url.includes('?') ? '&' : '?'
  return {
    id: 'adjunto-inicial',
    nombre,
    url: ticket.archivo_url,
    urlDescarga: `${ticket.archivo_url}${separador}download=${encodeURIComponent(nombre)}`,
    tamano: null,
    autor: ticket.solicitante ? nombreDe(ticket.solicitante) : 'Usuario eliminado',
    fecha: ticket.created_at,
    origen: 'Creación de la solicitud',
  }
}

export function ArchivosTicket({ ticket }: { ticket: TicketConRelaciones }) {
  const [archivos, setArchivos] = useState<ArchivoConRelaciones[]>([])
  const [loading, setLoading] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    void supabase
      .from('ticket_archivos')
      .select(`
        *,
        autor:profiles!ticket_archivos_subido_por_fkey(id, full_name, email),
        comentario:ticket_comentarios!ticket_archivos_comentario_id_fkey(texto)
      `)
      .eq('ticket_id', ticket.id)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (!vigente) return
        if (error) console.error('No se pudieron cargar los archivos:', error.message)
        setErrorCarga(error ? 'No se pudieron cargar los archivos.' : null)
        setArchivos((data as unknown as ArchivoConRelaciones[]) ?? [])
        setLoading(false)
      })
    return () => {
      vigente = false
    }
  }, [ticket.id])

  if (loading) return <p className="actividad__vacio">Cargando archivos...</p>
  if (errorCarga) return <p className="auth-error">{errorCarga}</p>

  const inicial = filaAdjuntoInicial(ticket)
  const filas: FilaArchivo[] = [
    ...(inicial ? [inicial] : []),
    ...archivos.map((archivo) => ({
      id: archivo.id,
      nombre: archivo.nombre,
      url: urlArchivo(archivo.ruta),
      urlDescarga: urlDescarga(archivo.ruta, archivo.nombre),
      tamano: archivo.tamano,
      autor: archivo.autor ? nombreDe(archivo.autor) : 'Usuario eliminado',
      fecha: archivo.created_at,
      origen: archivo.comentario
        ? archivo.comentario.texto.trim() ? `Comentario: “${extracto(archivo.comentario.texto)}”` : 'Comentario sin texto'
        // Sin comentario = adjunto al crear la solicitud (migración 0040).
        : 'Creación de la solicitud',
    })),
  ]

  if (filas.length === 0) {
    return (
      <p className="actividad__vacio">
        Esta tarea aún no tiene archivos. Adjúntalos desde un comentario con el ícono <strong>📎</strong>.
      </p>
    )
  }

  return (
    <ul className="archivos-ticket">
      {filas.map((fila) => (
        <li key={fila.id} className="archivos-ticket__fila">
          <a href={fila.url} target="_blank" rel="noreferrer" className="archivos-ticket__vista" title={`Abrir ${fila.nombre}`}>
            {esImagen(fila.nombre)
              ? <img src={fila.url} alt="" className="archivo-adjunto__miniatura" loading="lazy" />
              : <IconoArchivo nombre={fila.nombre} />}
          </a>
          <div className="archivos-ticket__datos">
            <a href={fila.url} target="_blank" rel="noreferrer" className="archivos-ticket__nombre" title={fila.nombre}>
              {fila.nombre}
            </a>
            <span className="archivos-ticket__meta">
              {fila.autor} · <time dateTime={fila.fecha}>{formatearFecha(fila.fecha)}</time>
              {fila.tamano ? <> · {pesoLegible(fila.tamano)}</> : null}
            </span>
            <span className="archivos-ticket__origen">{fila.origen}</span>
          </div>
          <a href={fila.urlDescarga} className="archivo-adjunto__descargar" aria-label={`Descargar ${fila.nombre}`} title="Descargar">
            <IconoDescarga />
          </a>
        </li>
      ))}
    </ul>
  )
}
