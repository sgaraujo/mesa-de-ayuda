import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatearTiempo } from '../lib/tiempo'
import { Avatar } from './Avatar'
import type { Profile, TicketCambio, TicketConRelaciones } from '../types/database'

type CambioConAutor = TicketCambio & { autor: Pick<Profile, 'full_name' | 'email'> | null }

const NOMBRE_CAMPO: Record<string, string> = {
  titulo: 'el título',
  descripcion: 'la descripción',
  prioridad: 'la prioridad',
  estado: 'el estado',
  fecha_requerida: 'la fecha requerida',
  asignado_a: 'la persona asignada',
  es_grupal: 'el tipo de tarea',
  area: 'el área',
  proyecto: 'el proyecto',
  tiempo_propuesto_horas: 'el tiempo propuesto',
  tiempo_ejecutado_horas: 'el tiempo ejecutado',
  nota_finalizacion: 'la nota de finalización',
}

// Campos de texto largo: se muestran como "editó" con el antes/después
// desplegable en vez de en una sola línea.
const CAMPOS_LARGOS = new Set(['descripcion', 'nota_finalizacion'])

const ETIQUETAS: Record<string, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  finalizado: 'Finalizado',
}

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatearValor(campo: string, valor: string | null): string {
  if (valor == null || valor === '') {
    if (campo === 'asignado_a') return 'Bandeja general'
    return 'Sin definir'
  }
  switch (campo) {
    case 'prioridad':
    case 'estado':
      return ETIQUETAS[valor] ?? valor
    case 'fecha_requerida':
      return formatearFecha(valor)
    case 'es_grupal':
      return valor === 'true' ? 'En grupo' : 'Individual'
    case 'tiempo_propuesto_horas':
    case 'tiempo_ejecutado_horas':
      return formatearTiempo(Number(valor))
    default:
      return valor
  }
}

function describirCambio(cambio: TicketCambio): string {
  if (cambio.campo === 'miembro') {
    return cambio.valor_nuevo
      ? `agregó a ${cambio.valor_nuevo} al grupo`
      : `quitó a ${cambio.valor_anterior ?? 'una persona'} del grupo`
  }
  const nombre = NOMBRE_CAMPO[cambio.campo] ?? cambio.campo
  if (CAMPOS_LARGOS.has(cambio.campo)) return `editó ${nombre}`
  return `cambió ${nombre} de «${formatearValor(cambio.campo, cambio.valor_anterior)}» a «${formatearValor(cambio.campo, cambio.valor_nuevo)}»`
}

interface HistorialCambiosProps {
  ticket: TicketConRelaciones
}

export function HistorialCambios({ ticket }: HistorialCambiosProps) {
  const [cambios, setCambios] = useState<CambioConAutor[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelado = false
    void supabase
      .from('ticket_cambios')
      .select('*, autor:profiles(full_name, email)')
      .eq('ticket_id', ticket.id)
      .order('changed_at', { ascending: false })
      .then(({ data }) => {
        if (cancelado) return
        setCambios((data as unknown as CambioConAutor[]) ?? [])
        setLoading(false)
      })
    return () => {
      cancelado = true
    }
  }, [ticket.id])

  const solicitante = ticket.solicitante?.full_name ?? ticket.solicitante?.email ?? 'Alguien'

  return (
    <div className="historial-panel">
      {loading ? (
        <p className="actividad__vacio">Cargando historial...</p>
      ) : (
        <ol className="historial-cambios">
          {cambios.map((cambio) => {
            const autor = cambio.autor?.full_name ?? cambio.autor?.email ?? 'Sistema'
            return (
              <li key={cambio.id} className="historial-cambios__item">
                <Avatar nombre={autor} tamano="sm" />
                <div className="historial-cambios__contenido">
                  <p className="historial-cambios__texto">
                    <strong>{autor}</strong> {describirCambio(cambio)}
                  </p>
                  <time className="historial-cambios__fecha" dateTime={cambio.changed_at}>
                    {formatearFecha(cambio.changed_at)}
                  </time>
                  {CAMPOS_LARGOS.has(cambio.campo) && (
                    <details className="historial-cambios__detalle">
                      <summary>Ver antes y después</summary>
                      <div className="historial-cambios__comparacion">
                        <div className="historial-cambios__version historial-cambios__version--antes">
                          <span>Antes</span>
                          <p>{cambio.valor_anterior || 'Sin definir'}</p>
                        </div>
                        <div className="historial-cambios__version historial-cambios__version--despues">
                          <span>Después</span>
                          <p>{cambio.valor_nuevo || 'Sin definir'}</p>
                        </div>
                      </div>
                    </details>
                  )}
                </div>
              </li>
            )
          })}
          <li className="historial-cambios__item">
            <Avatar nombre={solicitante} tamano="sm" />
            <div className="historial-cambios__contenido">
              <p className="historial-cambios__texto">
                <strong>{solicitante}</strong> creó la solicitud
              </p>
              <time className="historial-cambios__fecha" dateTime={ticket.created_at}>
                {formatearFecha(ticket.created_at)}
              </time>
            </div>
          </li>
        </ol>
      )}
    </div>
  )
}
