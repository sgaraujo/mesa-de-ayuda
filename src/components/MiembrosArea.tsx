import { useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useArea } from '../context/AreaContext'
import { ConfirmDialog } from './ConfirmDialog'
import type { MiembroArea } from '../hooks/useMiembrosArea'
import type { Profile, RolArea } from '../types/database'

const ROL_LABEL: Record<RolArea, string> = {
  lider: 'Líder',
  agente: 'Agente',
}

interface MiembrosAreaProps {
  areaId: string
  areaNombre: string
  miembros: MiembroArea[]
  perfiles: Pick<Profile, 'id' | 'full_name' | 'email'>[]
  onCambio: () => Promise<void>
}

// Alta, cambio de rol y baja de miembros de un área. Lo usa el líder del área
// (o el superadmin); RLS de area_miembros impide hacerlo a cualquier otro.
export function MiembrosArea({ areaId, areaNombre, miembros, perfiles, onCambio }: MiembrosAreaProps) {
  const { profile } = useAuth()
  const { esSuperadmin, recargar: recargarAreas } = useArea()

  const [nuevoPerfilId, setNuevoPerfilId] = useState('')
  const [nuevoRol, setNuevoRol] = useState<RolArea>('agente')
  const [porQuitar, setPorQuitar] = useState<{ id: string; nombre: string } | null>(null)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const candidatos = useMemo(() => {
    const yaMiembros = new Set(miembros.map((m) => m.profile.id))
    return perfiles.filter((p) => !yaMiembros.has(p.id))
  }, [perfiles, miembros])

  // Un líder no puede quitarse ni bajarse el rol a sí mismo, para que el área
  // no se quede sin líder por accidente.
  function puedeEditar(profileId: string) {
    return esSuperadmin || profileId !== profile?.id
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

  async function cambiarRol(profileId: string, rol: RolArea) {
    setError(null)
    const { error: errorUpdate } = await supabase
      .from('area_miembros')
      .update({ rol })
      .eq('area_id', areaId)
      .eq('profile_id', profileId)
    if (errorUpdate) {
      setError('No se pudo cambiar el rol. Intenta de nuevo.')
      return
    }
    await onCambio()
    if (profileId === profile?.id) await recargarAreas()
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
      <form className="miembros-area__alta" onSubmit={agregarMiembro}>
        <label>
          Agregar persona
          <select value={nuevoPerfilId} onChange={(e) => setNuevoPerfilId(e.target.value)} required>
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
        <button type="submit" disabled={procesando || !nuevoPerfilId}>
          Agregar
        </button>
      </form>
      <p className="admin-table__texto-sutil">
        ¿No aparece la persona? Primero debe tener acceso a la aplicación (whitelist) y haber creado su cuenta.
      </p>

      {error && <p className="auth-error">{error}</p>}

      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Rol</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {miembros.map((m) => {
              const nombre = m.profile.full_name ?? m.profile.email
              const editable = puedeEditar(m.profile.id)
              return (
                <tr key={m.profile.id}>
                  <td>
                    {nombre}
                    {!m.profile.activo && <span className="admin-table__texto-sutil"> · Revocado</span>}
                  </td>
                  <td>
                    <span className="admin-table__texto-sutil">{m.profile.email}</span>
                  </td>
                  <td>
                    {editable ? (
                      <select
                        value={m.rol}
                        onChange={(e) => void cambiarRol(m.profile.id, e.target.value as RolArea)}
                        aria-label={`Rol de ${nombre}`}
                      >
                        <option value="agente">Agente</option>
                        <option value="lider">Líder</option>
                      </select>
                    ) : (
                      ROL_LABEL[m.rol]
                    )}
                  </td>
                  <td>
                    {editable && (
                      <button
                        type="button"
                        className="admin-table__accion-eliminar"
                        onClick={() => setPorQuitar({ id: m.profile.id, nombre })}
                      >
                        Quitar
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {miembros.length === 0 && (
              <tr>
                <td colSpan={4} className="admin-table__texto-sutil">
                  Este grupo todavía no tiene miembros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
