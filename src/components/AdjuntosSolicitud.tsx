import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { urlArchivo, urlDescarga } from '../lib/archivos'
import { ArchivoAdjunto } from './ArchivoAdjunto'
import type { TicketArchivo } from '../types/database'

// Archivos que se adjuntaron al crear la solicitud (ticket_archivos sin
// comentario, migración 0040). Si no hay, no muestra nada.
export function AdjuntosSolicitud({ ticketId }: { ticketId: string }) {
  const [archivos, setArchivos] = useState<TicketArchivo[]>([])

  useEffect(() => {
    let vigente = true
    void supabase
      .from('ticket_archivos')
      .select('*')
      .eq('ticket_id', ticketId)
      .is('comentario_id', null)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) console.error('No se pudieron cargar los adjuntos de la solicitud:', error.message)
        if (vigente) setArchivos((data as TicketArchivo[] | null) ?? [])
      })
    return () => {
      vigente = false
    }
  }, [ticketId])

  if (archivos.length === 0) return null

  return (
    <section className="detalle__seccion">
      <h3 className="detalle__seccion-titulo">
        {archivos.length === 1 ? 'Archivo adjunto' : `Archivos adjuntos (${archivos.length})`}
      </h3>
      <div className="adjuntos-solicitud">
        {archivos.map((archivo) => (
          <ArchivoAdjunto
            key={archivo.id}
            nombre={archivo.nombre}
            url={urlArchivo(archivo.ruta)}
            urlDescarga={urlDescarga(archivo.ruta, archivo.nombre)}
            tamano={archivo.tamano}
          />
        ))}
      </div>
    </section>
  )
}
