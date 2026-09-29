import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useArea } from '../context/AreaContext'
import { useMiembrosArea } from '../hooks/useMiembrosArea'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { Profile, RolArea } from '../types/database'

const ROL_LABEL: Record<RolArea, string> = {
  admin: 'Admin',
  agente: 'Agente',
  solicitante: 'Solicitante',
}

// El admin de un área decide quién entra a su tablero y con qué rol. El acceso
// a la aplicación (whitelist) lo sigue gestionando solo el superadmin.
export function AreaMiembrosPage() {
  const { profile } = useAuth()
  const { areaActiva, esSuperadmin, recargar: recargarAreas } = useArea()
  const areaId = areaActiva?.id
  const { miembros, loading, recargar } = useMiembrosArea(areaId)

  const [perfiles, setPerfiles] = useState<Pick<Profile, 'id' | 'full_name' | 'email'>[]>([])
  const [nuevoPerfilId, setNuevoPerfilId] = useState('')
  const [nuevoRol, setNuevoRol] = useState<RolArea>('solicitante')
  const [porQuitar, setPorQuitar] = useState<{ id: string; nombre: string } | null>(null)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('activo', true)
      .order('full_name')
      .then(({ data }) => setPerfiles(data ?? []))
  }, [])

  const candidatos = useMemo(() => {
    const yaMiembros = new Set(miembros.map((m) => m.profile.id))
    return perfiles.filter((p) => !yaMiembros.has(p.id))
  }, [perfiles, miembros])

  // Un admin de área no puede quitarse ni bajarse el rol a sí mismo, para que
  // el área no se quede sin nadie que la administre por accidente.
  function puedeEditar(profileId: string) {
    return esSuperadmin || profileId !== profile?.id
  }

  async function agregarMiembro(e: FormEvent) {
    e.preventDefault()
    if (!areaId || !nuevoPerfilId) return
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
    setNuevoRol('solicitante')
    await recargar()
  }

  async function cambiarRol(profileId: string, rol: RolArea) {
    if (!areaId) return
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
    await recargar()
    if (profileId === profile?.id) await recargarAreas()
  }

  async function quitarMiembro() {
    if (!areaId || !porQuitar) return
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
    await recargar()
  }

  if (loading) return <div className="pantalla-carga">Cargando miembros...</div>

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div className="admin-header__texto">
          <h1>Miembros · {areaActiva?.nombre}</h1>
          <p className="auth-hint">
            Solo los agentes y admins trabajan el tablero de esta área; los admins además administran
            los miembros. Cualquier persona, sea o no miembro, puede enviarle solicitudes al área.
          </p>
        </div>
      </div>

      <form className="admin-panel-flotante" onSubmit={agregarMiembro}>
        <h2 className="admin-panel-flotante__titulo">Agregar miembro</h2>
        <div className="admin-toolbar__fila">
          <div className="admin-toolbar__campos">
            <label>
              Persona
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
                <option value="solicitante">Solicitante</option>
                <option value="agente">Agente</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
          <button type="submit" disabled={procesando || !nuevoPerfilId}>
            Agregar
          </button>
        </div>
        <p className="admin-table__texto-sutil">
          ¿No aparece la persona? Primero debe tener acceso a la aplicación (whitelist) y haber creado su cuenta.
        </p>
      </form>

      {error && <p className="auth-error">{error}</p>}

      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Rol en el área</th>
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
                        <option value="solicitante">Solicitante</option>
                        <option value="agente">Agente</option>
                        <option value="admin">Admin</option>
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
                  Esta área todavía no tiene miembros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        abierto={porQuitar !== null}
        titulo="Quitar del área"
        descripcion={`${porQuitar?.nombre ?? ''} dejará de ver el tablero de ${areaActiva?.nombre ?? 'esta área'}. Sus tareas se conservan.`}
        textoConfirmar="Quitar"
        procesando={procesando}
        onCancelar={() => setPorQuitar(null)}
        onConfirmar={() => void quitarMiembro()}
      />
    </div>
  )
}
