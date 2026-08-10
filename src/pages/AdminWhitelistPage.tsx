import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAreas } from '../hooks/useAreas'
import type { AllowedEmail, Role } from '../types/database'

export function AdminWhitelistPage() {
  const { areas } = useAreas()
  const [emails, setEmails] = useState<AllowedEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [nuevoEmail, setNuevoEmail] = useState('')
  const [nuevoRole, setNuevoRole] = useState<Role>('solicitante')
  const [nuevaArea, setNuevaArea] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [editandoEmail, setEditandoEmail] = useState<string | null>(null)
  const [editRole, setEditRole] = useState<Role>('solicitante')
  const [editAreaId, setEditAreaId] = useState('')

  const [reenviando, setReenviando] = useState<string | null>(null)
  const [enviandoBienvenida, setEnviandoBienvenida] = useState<string | null>(null)
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [enviandoSeleccionados, setEnviandoSeleccionados] = useState(false)
  const [mensajeMasivo, setMensajeMasivo] = useState<string | null>(null)
  const [mensajeAccion, setMensajeAccion] = useState<{ email: string; texto: string } | null>(null)

  async function cargar() {
    setLoading(true)
    const { data } = await supabase
      .from('allowed_emails')
      .select('*')
      .order('invited_at', { ascending: false })
    const registros = data ?? []
    setEmails(registros)
    setSeleccionados((actuales) => {
      const correosDisponibles = new Set(registros.filter((registro) => registro.used_at).map((registro) => registro.email))
      return new Set([...actuales].filter((email) => correosDisponibles.has(email)))
    })
    setLoading(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  async function agregarCorreo(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const email = nuevoEmail.trim().toLowerCase()

    const { error } = await supabase.from('allowed_emails').upsert({
      email,
      role: nuevoRole,
      area_id: nuevaArea || null,
    })

    if (error) {
      setError('No se pudo agregar el correo.')
      return
    }

    setNuevoEmail('')
    cargar()
  }

  async function handleCsv(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const texto = await file.text()

    const filas = texto
      .split('\n')
      .map((linea) => linea.trim())
      .filter(Boolean)
      .map((linea) => linea.split(','))

    const registros = filas
      .map(([email, role, areaNombre]) => ({
        email: email?.trim().toLowerCase(),
        role: (role?.trim() as Role) || 'solicitante',
        area_id: areas.find((a) => a.nombre.toLowerCase() === areaNombre?.trim().toLowerCase())?.id ?? null,
      }))
      .filter((r) => r.email)

    if (registros.length > 0) {
      await supabase.from('allowed_emails').upsert(registros)
      cargar()
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function iniciarEdicion(e: AllowedEmail) {
    setEditandoEmail(e.email)
    setEditRole(e.role)
    setEditAreaId(e.area_id ?? '')
    setMensajeAccion(null)
  }

  async function guardarEdicion(email: string) {
    const { error } = await supabase
      .from('allowed_emails')
      .update({ role: editRole, area_id: editAreaId || null })
      .eq('email', email)

    if (error) {
      setMensajeAccion({ email, texto: 'No se pudo guardar el cambio.' })
      return
    }

    const registro = emails.find((e) => e.email === email)
    if (registro?.used_at) {
      const { error: errorPerfil } = await supabase
        .from('profiles')
        .update({ role: editRole, area_id: editAreaId || null })
        .eq('email', email)

      if (errorPerfil) {
        setMensajeAccion({ email, texto: 'Se guardó en la whitelist pero no se pudo actualizar el perfil activo.' })
        setEditandoEmail(null)
        cargar()
        return
      }
    }

    setEditandoEmail(null)
    cargar()
  }

  async function eliminarCorreo(email: string) {
    if (!confirm(`¿Eliminar ${email} de la whitelist?`)) return

    const { error } = await supabase.from('allowed_emails').delete().eq('email', email)
    if (error) {
      setMensajeAccion({ email, texto: 'No se pudo eliminar.' })
      return
    }
    setSeleccionados((actuales) => {
      const siguientes = new Set(actuales)
      siguientes.delete(email)
      return siguientes
    })
    setMensajeMasivo(null)
    cargar()
  }

  async function reenviarCorreo(email: string) {
    setReenviando(email)
    setMensajeAccion(null)
    const { error } = await supabase.functions.invoke('invite-user', { body: { email } })
    setReenviando(null)
    setMensajeAccion({
      email,
      texto: error ? 'No se pudo reenviar. Intenta de nuevo.' : 'Correo reenviado.',
    })
    cargar()
  }

  async function enviarBienvenida(email: string) {
    setEnviandoBienvenida(email)
    setMensajeAccion(null)
    const { error } = await supabase.functions.invoke('send-welcome-email', { body: { email } })
    setEnviandoBienvenida(null)
    setMensajeAccion({
      email,
      texto: error ? 'No se pudo enviar la bienvenida.' : 'Bienvenida enviada.',
    })
  }

  function alternarSeleccion(email: string) {
    setSeleccionados((actuales) => {
      const siguientes = new Set(actuales)
      if (siguientes.has(email)) siguientes.delete(email)
      else siguientes.add(email)
      return siguientes
    })
    setMensajeMasivo(null)
  }

  async function enviarBienvenidasSeleccionadas() {
    if (seleccionados.size === 0) return
    setEnviandoSeleccionados(true)
    setMensajeMasivo(null)

    const destinos = [...seleccionados]
    const resultados = await Promise.all(
      destinos.map(async (email) => {
        const { error } = await supabase.functions.invoke('send-welcome-email', { body: { email } })
        return { email, error }
      }),
    )
    const fallidos = resultados.filter((resultado) => resultado.error)

    setEnviandoSeleccionados(false)
    if (fallidos.length === 0) {
      setMensajeMasivo(`Se enviaron ${destinos.length} correo${destinos.length === 1 ? '' : 's'} de bienvenida.`)
      setSeleccionados(new Set())
    } else {
      setMensajeMasivo(`Se enviaron ${destinos.length - fallidos.length} de ${destinos.length}. Revisa los correos que fallaron.`)
      setSeleccionados(new Set(fallidos.map((resultado) => resultado.email)))
    }
  }

  if (loading) return <div className="pantalla-carga">Cargando whitelist...</div>

  function renderFila(e: AllowedEmail) {
    const enEdicion = editandoEmail === e.email
    return (
      <tr key={e.email}>
        <td className="admin-table__seleccion">
          <input
            type="checkbox"
            aria-label={`Seleccionar ${e.email}`}
            checked={seleccionados.has(e.email)}
            disabled={!e.used_at || enviandoSeleccionados}
            onChange={() => alternarSeleccion(e.email)}
            title={e.used_at ? 'Seleccionar para enviar bienvenida' : 'Primero debe completar el registro'}
          />
        </td>
        <td>
          <div className="admin-persona">
            <span className="admin-persona__avatar">{e.email.charAt(0).toUpperCase()}</span>
            {e.email}
          </div>
        </td>
        <td>
          {enEdicion ? (
            <select value={editRole} onChange={(ev) => setEditRole(ev.target.value as Role)}>
              <option value="solicitante">Solicitante</option>
              <option value="agente">Agente</option>
              <option value="admin">Admin</option>
            </select>
          ) : (
            <span className="admin-table__texto-sutil">{e.role}</span>
          )}
        </td>
        <td>
          {enEdicion ? (
            <select value={editAreaId} onChange={(ev) => setEditAreaId(ev.target.value)}>
              <option value="">Sin definir</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.nombre}
                </option>
              ))}
            </select>
          ) : (
            <span className="admin-table__texto-sutil">
              {areas.find((a) => a.id === e.area_id)?.nombre ?? '—'}
            </span>
          )}
        </td>
        <td>
          <span className={`estado-punto ${e.used_at ? 'estado-punto--usado' : 'estado-punto--pendiente'}`}>
            {e.used_at ? 'Registrado' : 'Pendiente'}
          </span>
        </td>
        <td>
          <div className="admin-table__acciones">
            {enEdicion ? (
              <>
                <button type="button" className="admin-table__accion-primaria" onClick={() => guardarEdicion(e.email)}>
                  Guardar
                </button>
                <button
                  type="button"
                  className="admin-table__accion-secundaria"
                  onClick={() => setEditandoEmail(null)}
                >
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <button type="button" className="admin-table__accion-secundaria" onClick={() => iniciarEdicion(e)}>
                  Editar
                </button>
                {!e.used_at && (
                  <button
                    type="button"
                    className="admin-table__accion-secundaria"
                    onClick={() => reenviarCorreo(e.email)}
                    disabled={reenviando === e.email}
                  >
                    {reenviando === e.email ? 'Enviando...' : 'Reenviar correo'}
                  </button>
                )}
                {e.used_at && (
                  <button
                    type="button"
                    className="admin-table__accion-secundaria"
                    onClick={() => enviarBienvenida(e.email)}
                    disabled={enviandoBienvenida === e.email || enviandoSeleccionados}
                  >
                    {enviandoBienvenida === e.email ? 'Enviando...' : 'Enviar bienvenida'}
                  </button>
                )}
                <button type="button" className="admin-table__accion-eliminar" onClick={() => eliminarCorreo(e.email)}>
                  Eliminar
                </button>
              </>
            )}
            {mensajeAccion?.email === e.email && (
              <span className="admin-table__mensaje">{mensajeAccion.texto}</span>
            )}
          </div>
        </td>
      </tr>
    )
  }

  function renderPanel(titulo: string, lista: AllowedEmail[]) {
    return (
      <div className="admin-panel">
        <h2>
          {titulo} <span className="admin-panel__contador">{lista.length}</span>
        </h2>
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th className="admin-table__seleccion" aria-label="Seleccionar" />
                <th>Correo</th>
                <th>Rol</th>
                <th>Área</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(renderFila)}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={6} className="chart-card__vacio">
                    Sin correos en este rol
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Whitelist de correos autorizados</h1>
        <p className="auth-hint">
          Solo los correos aquí listados pueden solicitar acceso en /solicitar-acceso. CSV esperado:
          <code> correo,rol,area</code> (rol: admin, agente o solicitante).
        </p>
      </div>

      <form className="admin-toolbar" onSubmit={agregarCorreo}>
        <div className="admin-toolbar__campos">
          <label>
            Correo
            <input
              type="email"
              required
              value={nuevoEmail}
              onChange={(e) => setNuevoEmail(e.target.value)}
              placeholder="nombre@ejemplo.com"
            />
          </label>
          <label>
            Rol
            <select value={nuevoRole} onChange={(e) => setNuevoRole(e.target.value as Role)}>
              <option value="solicitante">Solicitante</option>
              <option value="agente">Agente</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label>
            Área
            <select value={nuevaArea} onChange={(e) => setNuevaArea(e.target.value)}>
              <option value="">Sin definir</option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="admin-toolbar__acciones">
          <label className="admin-toolbar__csv">
            Cargar CSV
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCsv} />
          </label>
          <button type="submit">Agregar correo</button>
        </div>
      </form>

      {error && <p className="auth-error">{error}</p>}

      <div className="admin-envio-bienvenida">
        <div>
          <strong>Correo de bienvenida</strong>
          <span>Selecciona personas registradas para invitarlas a crear y seguir tareas en la aplicación.</span>
        </div>
        <button
          type="button"
          onClick={enviarBienvenidasSeleccionadas}
          disabled={seleccionados.size === 0 || enviandoSeleccionados}
        >
          {enviandoSeleccionados
            ? 'Enviando...'
            : `Enviar a seleccionados${seleccionados.size > 0 ? ` (${seleccionados.size})` : ''}`}
        </button>
        {mensajeMasivo && <span className="admin-envio-bienvenida__mensaje">{mensajeMasivo}</span>}
      </div>

      <div className="admin-panels">
        {renderPanel('Administradores', emails.filter((e) => e.role === 'admin'))}
        {renderPanel('Agentes', emails.filter((e) => e.role === 'agente'))}
        {renderPanel('Solicitantes', emails.filter((e) => e.role === 'solicitante'))}
      </div>
    </div>
  )
}
