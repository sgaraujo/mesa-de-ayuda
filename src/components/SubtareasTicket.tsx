import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useMiembrosArea } from '../hooks/useMiembrosArea'
import { useConfirmar } from '../context/ConfirmacionContext'
import { formatearTiempo } from '../lib/tiempo'
import { nombreDe } from '../lib/menciones'
import { Avatar } from './Avatar'
import { SelectorPersona } from './SelectorPersona'
import type { EstadoSubtarea, Profile, TicketSubtarea } from '../types/database'

type SubtareaConResponsable = TicketSubtarea & {
  responsable: Pick<Profile, 'id' | 'full_name' | 'email'> | null
}

const ESTADO_LABEL: Record<EstadoSubtarea, string> = {
  pendiente: 'Pendiente',
  en_proceso: 'En proceso',
  finalizada: 'Finalizada',
}

const SIN_RESPONSABLE = [{ valor: '', etiqueta: 'Sin responsable' }]

const SELECT_SUBTAREAS = '*, responsable:profiles!ticket_subtareas_responsable_id_fkey(id, full_name, email)'

// "1,5" o "1.5" → 1.5; vacío → null. Devuelve undefined si no es válido.
function leerHoras(texto: string): number | null | undefined {
  const limpio = texto.trim().replace(',', '.')
  if (limpio === '') return null
  const valor = Number(limpio)
  return Number.isFinite(valor) && valor >= 0 && valor < 10000 ? valor : undefined
}

function horasTexto(valor: number | null): string {
  return valor == null ? '' : String(Math.round(valor * 100) / 100)
}

interface SubtareasTicketProps {
  ticketId: string
  areaId: string
  // Equipo del área: crea, edita y borra. Los demás (quien la pidió) solo ven.
  puedeGestionar: boolean
  // Las subtareas cambian los tiempos y el avance de la tarea (trigger de
  // 0042): el tablero refresca la tarjeta.
  onCambio?: () => void
}

// Actividades de la tarea con su responsable, estado y tiempos. El tiempo
// de la tarea es la suma de estas (lo calcula la base de datos).
export function SubtareasTicket({ ticketId, areaId, puedeGestionar, onCambio }: SubtareasTicketProps) {
  const { agentes } = useMiembrosArea(puedeGestionar ? areaId : undefined)
  const confirmar = useConfirmar()
  const [subtareas, setSubtareas] = useState<SubtareaConResponsable[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nuevoTitulo, setNuevoTitulo] = useState('')
  const [nuevoResponsable, setNuevoResponsable] = useState('')
  const [nuevoEstimado, setNuevoEstimado] = useState('')
  const [creando, setCreando] = useState(false)

  const cargar = useCallback(async () => {
    const { data, error: errorCarga } = await supabase
      .from('ticket_subtareas')
      .select(SELECT_SUBTAREAS)
      .eq('ticket_id', ticketId)
      .order('orden')
      .order('created_at')
    if (errorCarga) console.error('No se pudieron cargar las subtareas:', errorCarga.message)
    setSubtareas((data as unknown as SubtareaConResponsable[] | null) ?? [])
    setLoading(false)
  }, [ticketId])

  useEffect(() => {
    void cargar()
    const canal = supabase
      .channel(`subtareas:${ticketId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_subtareas', filter: `ticket_id=eq.${ticketId}` }, () => void cargar())
      .subscribe()
    return () => {
      void supabase.removeChannel(canal)
    }
  }, [ticketId, cargar])

  async function actualizar(id: string, cambios: Partial<TicketSubtarea>) {
    setError(null)
    setSubtareas((prev) => prev.map((s) => (s.id === id ? { ...s, ...cambios } : s)))
    const { error: errorGuardar } = await supabase.from('ticket_subtareas').update(cambios).eq('id', id)
    if (errorGuardar) {
      console.error('No se pudo guardar la subtarea:', errorGuardar.message)
      setError(`No se pudo guardar: ${errorGuardar.message}`)
    }
    await cargar()
    onCambio?.()
  }

  async function eliminar(subtarea: SubtareaConResponsable) {
    if (!(await confirmar({
      titulo: '¿Eliminar la subtarea?',
      descripcion: `"${subtarea.titulo}" se eliminará y su tiempo dejará de sumarse a la tarea.`,
      textoConfirmar: 'Eliminar',
    }))) return
    setError(null)
    const { error: errorBorrar } = await supabase.from('ticket_subtareas').delete().eq('id', subtarea.id)
    if (errorBorrar) setError(`No se pudo eliminar: ${errorBorrar.message}`)
    await cargar()
    onCambio?.()
  }

  async function crear(e: FormEvent) {
    e.preventDefault()
    const estimado = leerHoras(nuevoEstimado)
    if (!nuevoTitulo.trim()) return
    if (estimado === undefined) {
      setError('El tiempo estimado debe ser un número de horas (p. ej. 1,5).')
      return
    }
    setCreando(true)
    setError(null)
    const { error: errorCrear } = await supabase.from('ticket_subtareas').insert({
      ticket_id: ticketId,
      titulo: nuevoTitulo.trim(),
      responsable_id: nuevoResponsable || null,
      tiempo_estimado_horas: estimado,
      orden: subtareas.length,
    })
    setCreando(false)
    if (errorCrear) {
      setError(`No se pudo crear la subtarea: ${errorCrear.message}`)
      return
    }
    setNuevoTitulo('')
    setNuevoEstimado('')
    await cargar()
    onCambio?.()
  }

  function guardarHoras(subtarea: SubtareaConResponsable, campo: 'tiempo_estimado_horas' | 'tiempo_ejecutado_horas', texto: string) {
    const valor = leerHoras(texto)
    if (valor === undefined) {
      setError('Escribe las horas como número (p. ej. 1,5).')
      return
    }
    if (valor !== subtarea[campo]) void actualizar(subtarea.id, { [campo]: valor })
  }

  if (loading) return <p className="actividad__vacio">Cargando subtareas...</p>
  if (subtareas.length === 0 && !puedeGestionar) return null

  const finalizadas = subtareas.filter((s) => s.estado === 'finalizada').length
  const avance = subtareas.length > 0 ? Math.round((finalizadas / subtareas.length) * 100) : 0
  const estimado = subtareas.reduce((acc, s) => acc + (s.tiempo_estimado_horas ?? 0), 0)
  const ejecutado = subtareas.reduce((acc, s) => acc + (s.tiempo_ejecutado_horas ?? 0), 0)
  const porPersona = new Map<string, number>()
  for (const s of subtareas) {
    if (!s.tiempo_ejecutado_horas) continue
    const nombre = s.responsable ? nombreDe(s.responsable) : 'Sin responsable'
    porPersona.set(nombre, (porPersona.get(nombre) ?? 0) + s.tiempo_ejecutado_horas)
  }

  return (
    <section className="detalle__seccion subtareas" aria-labelledby="subtareas-titulo">
      <div className="subtareas__encabezado">
        <h3 id="subtareas-titulo" className="detalle__seccion-titulo">
          Subtareas{subtareas.length > 0 && ` · ${finalizadas}/${subtareas.length}`}
        </h3>
        {subtareas.length > 0 && (
          <span className="subtareas__tiempos" title="Ejecutado / estimado de todas las subtareas">
            {formatearTiempo(ejecutado)} de {estimado > 0 ? formatearTiempo(estimado) : '—'} estimado
          </span>
        )}
      </div>

      {subtareas.length > 0 && (
        <>
          <div className="subtareas__avance" aria-label={`${avance} % de las subtareas finalizadas`}>
            <div className="tiempo-avance__barra" aria-hidden="true">
              <span className="tiempo-avance__relleno" style={{ width: `${avance}%` }} />
            </div>
            <span>{avance} %</span>
          </div>

          <ul className="subtareas__lista">
            {subtareas.map((s) => {
              const excedida = s.tiempo_estimado_horas != null && s.tiempo_ejecutado_horas != null
                && s.tiempo_ejecutado_horas > s.tiempo_estimado_horas
              return (
                <li key={s.id} className={`subtarea subtarea--${s.estado}`}>
                  {puedeGestionar ? (
                    <>
                      <select
                        className={`subtarea__estado subtarea__estado--${s.estado}`}
                        value={s.estado}
                        onChange={(e) => void actualizar(s.id, { estado: e.target.value as EstadoSubtarea })}
                        aria-label={`Estado de ${s.titulo}`}
                      >
                        {(Object.keys(ESTADO_LABEL) as EstadoSubtarea[]).map((estado) => (
                          <option key={estado} value={estado}>{ESTADO_LABEL[estado]}</option>
                        ))}
                      </select>
                      <input
                        key={`titulo-${s.id}-${s.titulo}`}
                        className="subtarea__titulo"
                        defaultValue={s.titulo}
                        maxLength={200}
                        aria-label="Título de la subtarea"
                        onBlur={(e) => {
                          const titulo = e.target.value.trim()
                          if (titulo && titulo !== s.titulo) void actualizar(s.id, { titulo })
                          else e.target.value = s.titulo
                        }}
                      />
                      <SelectorPersona
                        className="subtarea__responsable"
                        // Alguien que ya salió del área sigue visible en sus subtareas.
                        personas={s.responsable && !agentes.some((a) => a.id === s.responsable!.id)
                          ? [s.responsable, ...agentes]
                          : agentes}
                        valor={s.responsable_id ?? ''}
                        onCambiar={(valor) => {
                          if (valor !== (s.responsable_id ?? '')) void actualizar(s.id, { responsable_id: valor || null })
                        }}
                        opcionesFijas={SIN_RESPONSABLE}
                        placeholder="Sin responsable"
                        aria-label={`Responsable de ${s.titulo}`}
                      />
                      <span className={`subtarea__horas${excedida ? ' subtarea__horas--excedida' : ''}`}>
                        <input
                          key={`ejecutado-${s.id}-${s.tiempo_ejecutado_horas}`}
                          inputMode="decimal"
                          defaultValue={horasTexto(s.tiempo_ejecutado_horas)}
                          placeholder="0"
                          aria-label={`Horas ejecutadas de ${s.titulo}`}
                          title="Horas ejecutadas"
                          onBlur={(e) => guardarHoras(s, 'tiempo_ejecutado_horas', e.target.value)}
                        />
                        <span>/</span>
                        <input
                          key={`estimado-${s.id}-${s.tiempo_estimado_horas}`}
                          inputMode="decimal"
                          defaultValue={horasTexto(s.tiempo_estimado_horas)}
                          placeholder="—"
                          aria-label={`Horas estimadas de ${s.titulo}`}
                          title="Horas estimadas"
                          onBlur={(e) => guardarHoras(s, 'tiempo_estimado_horas', e.target.value)}
                        />
                        <span>h</span>
                      </span>
                      <button
                        type="button"
                        className="detalle__boton-icono detalle__boton-icono--peligro subtarea__eliminar"
                        onClick={() => void eliminar(s)}
                        aria-label={`Eliminar ${s.titulo}`}
                        title="Eliminar subtarea"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <>
                      <span className={`badge subtarea__estado subtarea__estado--${s.estado}`}>{ESTADO_LABEL[s.estado]}</span>
                      <span className="subtarea__titulo">{s.titulo}</span>
                      <span className="subtarea__responsable">
                        {s.responsable ? nombreDe(s.responsable) : 'Sin responsable'}
                      </span>
                      <span className={`subtarea__horas${excedida ? ' subtarea__horas--excedida' : ''}`}>
                        {s.tiempo_ejecutado_horas != null ? formatearTiempo(s.tiempo_ejecutado_horas) : '—'}
                        {s.tiempo_estimado_horas != null && <> / {formatearTiempo(s.tiempo_estimado_horas)}</>}
                      </span>
                    </>
                  )}
                </li>
              )
            })}
          </ul>

          {porPersona.size > 0 && (
            <div className="subtareas__personas" aria-label="Tiempo ejecutado por persona">
              {[...porPersona.entries()].sort((a, b) => b[1] - a[1]).map(([nombre, horas]) => (
                <span key={nombre} className="subtareas__persona">
                  <Avatar nombre={nombre} tamano="sm" />
                  {nombre} · <strong>{formatearTiempo(horas)}</strong>
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {puedeGestionar && (
        <form className="subtareas__nueva" onSubmit={crear}>
          <input
            value={nuevoTitulo}
            onChange={(e) => setNuevoTitulo(e.target.value)}
            placeholder={subtareas.length === 0 ? 'Divide la tarea: p. ej. Levantamiento de requerimientos' : 'Nueva subtarea'}
            maxLength={200}
            aria-label="Título de la nueva subtarea"
          />
          <SelectorPersona
            personas={agentes}
            valor={nuevoResponsable}
            onCambiar={setNuevoResponsable}
            opcionesFijas={SIN_RESPONSABLE}
            placeholder="Responsable"
            aria-label="Responsable de la nueva subtarea"
          />
          <input
            className="subtareas__nueva-horas"
            inputMode="decimal"
            value={nuevoEstimado}
            onChange={(e) => setNuevoEstimado(e.target.value)}
            placeholder="Estimado (h)"
            aria-label="Horas estimadas de la nueva subtarea"
          />
          <button type="submit" disabled={creando || !nuevoTitulo.trim()}>
            {creando ? 'Agregando…' : 'Agregar'}
          </button>
        </form>
      )}
      {error && <p className="auth-error">{error}</p>}
    </section>
  )
}
