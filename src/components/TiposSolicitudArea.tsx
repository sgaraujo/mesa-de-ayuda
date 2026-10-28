import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { TipoSolicitud } from '../types/database'

interface TiposSolicitudAreaProps {
  areaId: string
  tipos: TipoSolicitud[]
  onCambio: () => Promise<void>
}

function mensajeError(error: { code?: string }, accion: string): string {
  if (error.code === '23505') return 'Ya existe un tipo con ese nombre en este grupo.'
  return `No se pudo ${accion}. Intenta de nuevo.`
}

// Catálogo de tipos de solicitud de un área. Si tiene tipos activos, quien
// le envía una solicitud debe elegir uno. Lo administra el líder del área (o
// el superadmin); RLS de tipos_solicitud impide a cualquier otro hacer
// cambios. No se borran: desactivar lo quita del formulario y las tareas que
// ya lo tienen lo conservan.
export function TiposSolicitudArea({ areaId, tipos, onCambio }: TiposSolicitudAreaProps) {
  const [abierto, setAbierto] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [nombreEditado, setNombreEditado] = useState('')
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activos = tipos.filter((t) => t.activo).length

  async function agregar(e: FormEvent) {
    e.preventDefault()
    const nombre = nuevoNombre.trim()
    if (!nombre) return
    setError(null)
    setProcesando(true)
    const orden = tipos.reduce((max, t) => Math.max(max, t.orden), 0) + 1
    const { error: errorInsert } = await supabase
      .from('tipos_solicitud')
      .insert({ area_id: areaId, nombre, orden })
    setProcesando(false)
    if (errorInsert) {
      setError(mensajeError(errorInsert, 'agregar el tipo'))
      return
    }
    setNuevoNombre('')
    await onCambio()
  }

  async function guardarNombre(tipo: TipoSolicitud) {
    const nombre = nombreEditado.trim()
    setEditandoId(null)
    if (!nombre || nombre === tipo.nombre) return
    setError(null)
    setProcesando(true)
    const { error: errorUpdate } = await supabase
      .from('tipos_solicitud')
      .update({ nombre })
      .eq('id', tipo.id)
    setProcesando(false)
    if (errorUpdate) setError(mensajeError(errorUpdate, 'renombrar el tipo'))
    await onCambio()
  }

  function teclaEdicion(e: KeyboardEvent<HTMLInputElement>, tipo: TipoSolicitud) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void guardarNombre(tipo)
    } else if (e.key === 'Escape') {
      setEditandoId(null)
    }
  }

  async function cambiarActivo(tipo: TipoSolicitud) {
    setError(null)
    setProcesando(true)
    const { error: errorUpdate } = await supabase
      .from('tipos_solicitud')
      .update({ activo: !tipo.activo })
      .eq('id', tipo.id)
    setProcesando(false)
    if (errorUpdate) setError(mensajeError(errorUpdate, tipo.activo ? 'desactivar el tipo' : 'activar el tipo'))
    await onCambio()
  }

  // Reescribe el orden de toda la lista (1, 2, 3…) para que también quede
  // bien si había tipos con el mismo número.
  async function mover(indice: number, delta: -1 | 1) {
    const destino = indice + delta
    if (destino < 0 || destino >= tipos.length) return
    const lista = [...tipos]
    ;[lista[indice], lista[destino]] = [lista[destino], lista[indice]]
    const cambios = lista
      .map((t, i) => ({ id: t.id, orden: i + 1, anterior: t.orden }))
      .filter((c) => c.orden !== c.anterior)
    setError(null)
    setProcesando(true)
    const resultados = await Promise.all(
      cambios.map((c) => supabase.from('tipos_solicitud').update({ orden: c.orden }).eq('id', c.id)),
    )
    setProcesando(false)
    if (resultados.some((r) => r.error)) setError('No se pudo cambiar el orden. Intenta de nuevo.')
    await onCambio()
  }

  return (
    <div className="tipos-area">
      <button
        type="button"
        className="tipos-area__toggle"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9 6 6 6-6 6" />
        </svg>
        Tipos de solicitud
        <span className="tipos-area__cantidad">
          {tipos.length === 0 ? 'Sin catálogo' : `${activos} ${activos === 1 ? 'activo' : 'activos'}`}
        </span>
      </button>

      {abierto && (
        <div className="tipos-area__contenido">
          <p className="admin-table__texto-sutil tipos-area__ayuda">
            Si el grupo tiene tipos activos, quien le envíe una solicitud debe elegir uno. Desactivar un tipo
            lo quita del formulario; las tareas que ya lo tienen lo conservan.
          </p>

          {tipos.length > 0 && (
            <ol className="tipos-area__lista">
              {tipos.map((tipo, i) => (
                <li key={tipo.id} className={tipo.activo ? 'tipos-area__fila' : 'tipos-area__fila tipos-area__fila--inactivo'}>
                  {editandoId === tipo.id ? (
                    <input
                      className="tipos-area__input"
                      value={nombreEditado}
                      onChange={(e) => setNombreEditado(e.target.value)}
                      onKeyDown={(e) => teclaEdicion(e, tipo)}
                      onBlur={() => void guardarNombre(tipo)}
                      aria-label={`Nuevo nombre para ${tipo.nombre}`}
                      maxLength={120}
                      autoFocus
                    />
                  ) : (
                    <span className="tipos-area__nombre">
                      {tipo.nombre}
                      {!tipo.activo && <span className="equipo-persona__etiqueta">Inactivo</span>}
                    </span>
                  )}
                  <span className="tipos-area__acciones">
                    <button
                      type="button"
                      className="equipo-persona__boton"
                      onClick={() => void mover(i, -1)}
                      disabled={procesando || i === 0}
                      title="Subir"
                      aria-label={`Subir ${tipo.nombre}`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m6 15 6-6 6 6" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="equipo-persona__boton"
                      onClick={() => void mover(i, 1)}
                      disabled={procesando || i === tipos.length - 1}
                      title="Bajar"
                      aria-label={`Bajar ${tipo.nombre}`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="equipo-persona__boton"
                      onClick={() => {
                        setEditandoId(tipo.id)
                        setNombreEditado(tipo.nombre)
                      }}
                      disabled={procesando}
                      title="Renombrar"
                      aria-label={`Renombrar ${tipo.nombre}`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={tipo.activo ? 'equipo-persona__boton equipo-persona__boton--peligro' : 'equipo-persona__boton'}
                      onClick={() => void cambiarActivo(tipo)}
                      disabled={procesando}
                      title={tipo.activo ? 'Desactivar' : 'Activar'}
                      aria-label={`${tipo.activo ? 'Desactivar' : 'Activar'} ${tipo.nombre}`}
                    >
                      {tipo.activo ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M5.6 5.6l12.8 12.8" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
                        </svg>
                      )}
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}

          {error && <p className="auth-error">{error}</p>}

          <form className="tipos-area__alta" onSubmit={agregar}>
            <input
              className="tipos-area__input"
              value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)}
              placeholder="Nuevo tipo de solicitud…"
              aria-label="Nuevo tipo de solicitud"
              maxLength={120}
            />
            <button type="submit" disabled={procesando || !nuevoNombre.trim()}>
              Agregar
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
