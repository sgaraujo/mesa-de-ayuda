import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useArea } from '../context/AreaContext'
import { Avatar } from './Avatar'
import { ConfirmDialog } from './ConfirmDialog'
import type { MiembroArea } from '../hooks/useMiembrosArea'
import type { Profile, RolArea } from '../types/database'

const ZONAS: { rol: RolArea; titulo: string; descripcion: string }[] = [
  { rol: 'lider', titulo: 'Líderes', descripcion: 'Ven todo el tablero y gestionan el grupo' },
  { rol: 'agente', titulo: 'Agentes', descripcion: 'Ven lo asignado a ellos y la bandeja general' },
]

const OTRO_ROL: Record<RolArea, RolArea> = { lider: 'agente', agente: 'lider' }
const ROL_LABEL: Record<RolArea, string> = { lider: 'líder', agente: 'agente' }

interface MiembrosAreaProps {
  areaId: string
  areaNombre: string
  miembros: MiembroArea[]
  perfiles: Pick<Profile, 'id' | 'full_name' | 'email'>[]
  onCambio: () => Promise<void>
}

function nombreDe(perfil: Pick<Profile, 'full_name' | 'email'>): string {
  return perfil.full_name?.trim() || perfil.email
}

interface TarjetaPersonaProps {
  miembro: MiembroArea
  rol: RolArea
  editable: true | string
  guardando: boolean
  onCambiarRol: () => void
  onQuitar: () => void
}

function TarjetaPersona({ miembro, rol, editable, guardando, onCambiarRol, onQuitar }: TarjetaPersonaProps) {
  const nombre = nombreDe(miembro.profile)
  const puedeMover = editable === true
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: miembro.profile.id,
    disabled: !puedeMover,
  })

  return (
    <li
      ref={setNodeRef}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={[
        'equipo-persona',
        isDragging && 'equipo-persona--arrastrando',
        guardando && 'equipo-persona--guardando',
        !miembro.profile.activo && 'equipo-persona--revocada',
        !puedeMover && 'equipo-persona--fija',
      ].filter(Boolean).join(' ')}
      title={puedeMover ? `${miembro.profile.email} · Arrastra para cambiar el rol` : editable}
    >
      <span className="equipo-persona__agarre" {...(puedeMover ? listeners : {})} {...(puedeMover ? attributes : {})} aria-label={`Mover a ${nombre}`}>
        <Avatar nombre={nombre} tamano="sm" />
        <span className="equipo-persona__datos">
          <span className="equipo-persona__nombre">
            {nombre}
            {!miembro.profile.activo && <span className="equipo-persona__etiqueta">Revocado</span>}
          </span>
          <span className="equipo-persona__correo">{miembro.profile.email}</span>
        </span>
      </span>
      {puedeMover ? (
        <span className="equipo-persona__acciones">
          <button
            type="button"
            className="equipo-persona__boton"
            onClick={onCambiarRol}
            disabled={guardando}
            title={`Pasar a ${ROL_LABEL[OTRO_ROL[rol]]}`}
            aria-label={`Pasar a ${nombre} a ${ROL_LABEL[OTRO_ROL[rol]]}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 4v16M7 4 3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4" />
            </svg>
          </button>
          <button
            type="button"
            className="equipo-persona__boton equipo-persona__boton--peligro"
            onClick={onQuitar}
            disabled={guardando}
            title="Quitar del grupo"
            aria-label={`Quitar a ${nombre} del grupo`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </span>
      ) : (
        <span className="equipo-persona__etiqueta equipo-persona__etiqueta--tu">Tú</span>
      )}
    </li>
  )
}

function ZonaRol({ areaId, rol, titulo, descripcion, children, cantidad }: {
  areaId: string
  rol: RolArea
  titulo: string
  descripcion: string
  cantidad: number
  children: ReactNode
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id: `${areaId}:${rol}`, data: { rol } })

  return (
    <div
      ref={setNodeRef}
      className={[
        'equipo-zona',
        `equipo-zona--${rol}`,
        active && 'equipo-zona--activa',
        isOver && 'equipo-zona--encima',
      ].filter(Boolean).join(' ')}
    >
      <div className="equipo-zona__cabecera">
        <span className="equipo-zona__titulo">
          {titulo} <span className="equipo-zona__cantidad">{cantidad}</span>
        </span>
        <span className="equipo-zona__descripcion">{descripcion}</span>
      </div>
      <ul className="equipo-zona__lista">
        {children}
        {cantidad === 0 && <li className="equipo-zona__vacia">Arrastra aquí a alguien para hacerlo {ROL_LABEL[rol]}</li>}
      </ul>
    </div>
  )
}

// Equipo de un área: líderes y agentes en dos zonas; arrastrar a alguien de
// una a otra cambia su rol. También se agrega y se quita gente. Lo usa el
// líder del área (o el superadmin); RLS de area_miembros impide a cualquier
// otro hacer cambios.
export function MiembrosArea({ areaId, areaNombre, miembros, perfiles, onCambio }: MiembrosAreaProps) {
  const { profile } = useAuth()
  const { esSuperadmin, recargar: recargarAreas } = useArea()

  const [mostrarAlta, setMostrarAlta] = useState(false)
  const [nuevoPerfilId, setNuevoPerfilId] = useState('')
  const [nuevoRol, setNuevoRol] = useState<RolArea>('agente')
  const [porQuitar, setPorQuitar] = useState<{ id: string; nombre: string } | null>(null)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Cambios de rol ya hechos en pantalla mientras se guardan (respuesta
  // inmediata al soltar, sin esperar a que se recarguen los miembros).
  const [rolesOptimistas, setRolesOptimistas] = useState<Map<string, RolArea>>(new Map())

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  const candidatos = useMemo(() => {
    const yaMiembros = new Set(miembros.map((m) => m.profile.id))
    return perfiles.filter((p) => !yaMiembros.has(p.id))
  }, [perfiles, miembros])

  // Un líder no puede quitarse ni bajarse el rol a sí mismo, para que el área
  // no se quede sin líder por accidente. Devuelve true o el motivo.
  function edicion(profileId: string): true | string {
    if (esSuperadmin || profileId !== profile?.id) return true
    return 'No puedes cambiar tu propio rol ni quitarte del grupo'
  }

  function rolDe(m: MiembroArea): RolArea {
    return rolesOptimistas.get(m.profile.id) ?? m.rol
  }

  async function cambiarRol(profileId: string, rol: RolArea) {
    setError(null)
    setRolesOptimistas((prev) => new Map(prev).set(profileId, rol))
    const { error: errorUpdate } = await supabase
      .from('area_miembros')
      .update({ rol })
      .eq('area_id', areaId)
      .eq('profile_id', profileId)
    if (errorUpdate) setError('No se pudo cambiar el rol. Intenta de nuevo.')
    await onCambio()
    setRolesOptimistas((prev) => {
      const siguiente = new Map(prev)
      siguiente.delete(profileId)
      return siguiente
    })
    if (!errorUpdate && profileId === profile?.id) await recargarAreas()
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    const destino = over?.data.current?.rol as RolArea | undefined
    if (!destino) return
    const miembro = miembros.find((m) => m.profile.id === active.id)
    if (!miembro || rolDe(miembro) === destino || edicion(miembro.profile.id) !== true) return
    void cambiarRol(miembro.profile.id, destino)
  }

  async function agregarMiembro(e: FormEvent) {
    e.preventDefault()
    if (!nuevoPerfilId) return
    setError(null)
    setProcesando(true)
    const { error: errorInsert } = await supabase
      .from('area_miembros')
      .insert({ area_id: areaId, profile_id: nuevoPerfilId, rol: nuevoRol })
    setProcesando(false)
    if (errorInsert) {
      setError('No se pudo agregar a la persona. Intenta de nuevo.')
      return
    }
    setNuevoPerfilId('')
    await onCambio()
  }

  async function quitarMiembro() {
    if (!porQuitar) return
    setProcesando(true)
    setError(null)
    const { error: errorDelete } = await supabase
      .from('area_miembros')
      .delete()
      .eq('area_id', areaId)
      .eq('profile_id', porQuitar.id)
    setProcesando(false)
    setPorQuitar(null)
    if (errorDelete) {
      setError('No se pudo quitar a la persona. Intenta de nuevo.')
      return
    }
    await onCambio()
  }

  return (
    <div className="miembros-area">
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="equipo-zonas">
          {ZONAS.map((zona) => {
            const deRol = miembros.filter((m) => rolDe(m) === zona.rol)
            return (
              <ZonaRol key={zona.rol} areaId={areaId} cantidad={deRol.length} {...zona}>
                {deRol.map((m) => (
                  <TarjetaPersona
                    key={m.profile.id}
                    miembro={m}
                    rol={zona.rol}
                    editable={edicion(m.profile.id)}
                    guardando={rolesOptimistas.has(m.profile.id)}
                    onCambiarRol={() => void cambiarRol(m.profile.id, OTRO_ROL[zona.rol])}
                    onQuitar={() => setPorQuitar({ id: m.profile.id, nombre: nombreDe(m.profile) })}
                  />
                ))}
              </ZonaRol>
            )
          })}
        </div>
      </DndContext>

      {error && <p className="auth-error">{error}</p>}

      {mostrarAlta ? (
        <form className="miembros-area__alta" onSubmit={agregarMiembro}>
          <label>
            Persona
            <select value={nuevoPerfilId} onChange={(e) => setNuevoPerfilId(e.target.value)} required autoFocus>
              <option value="" disabled>
                Selecciona una persona
              </option>
              {candidatos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name ? `${p.full_name} (${p.email})` : p.email}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rol
            <select value={nuevoRol} onChange={(e) => setNuevoRol(e.target.value as RolArea)}>
              <option value="agente">Agente</option>
              <option value="lider">Líder</option>
            </select>
          </label>
          <div className="miembros-area__alta-botones">
            <button type="button" className="admin-table__accion-secundaria" onClick={() => setMostrarAlta(false)}>
              Cancelar
            </button>
            <button type="submit" disabled={procesando || !nuevoPerfilId}>
              Agregar
            </button>
          </div>
          <p className="admin-table__texto-sutil miembros-area__ayuda">
            ¿No aparece la persona? Primero debe tener acceso a la aplicación (whitelist) y haber creado su cuenta.
          </p>
        </form>
      ) : (
        <button type="button" className="miembros-area__agregar" onClick={() => setMostrarAlta(true)}>
          + Agregar persona
        </button>
      )}

      <ConfirmDialog
        abierto={porQuitar !== null}
        titulo="Quitar del grupo"
        descripcion={`${porQuitar?.nombre ?? ''} dejará de ver el tablero de ${areaNombre}. Sus tareas se conservan.`}
        textoConfirmar="Quitar"
        procesando={procesando}
        onCancelar={() => setPorQuitar(null)}
        onConfirmar={() => void quitarMiembro()}
      />
    </div>
  )
}
