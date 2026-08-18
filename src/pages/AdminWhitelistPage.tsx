import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAreas } from '../hooks/useAreas'
import type { AllowedEmail, Role } from '../types/database'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SetPasswordDialog } from '../components/SetPasswordDialog'
import { RowActionsMenu } from '../components/RowActionsMenu'

const TAMANO_BLOQUE_EQUIPO = 1000

const ETIQUETAS_ROL: Record<Role, string> = {
  admin: 'Admin',
  agente: 'Agente',
  solicitante: 'Solicitante',
}

function etiquetaRol(role: Role) {
  return ETIQUETAS_ROL[role]
}

async function mensajeDeErrorFuncion(error: unknown, fallback: string): Promise<string> {
  const contexto = (error as { context?: Response } | null)?.context
  if (contexto && typeof contexto.json === 'function') {
    try {
      const cuerpo = await contexto.clone().json()
      if (typeof cuerpo?.message === 'string' && cuerpo.message.trim()) return cuerpo.message
    } catch {
      // La respuesta no era JSON o ya se había leído: usamos el mensaje genérico.
    }
  }
  return fallback
}

export function AdminWhitelistPage() {
  const { areas } = useAreas()
  const [emails, setEmails] = useState<AllowedEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [pagina, setPagina] = useState(0)
  const [limite, setLimite] = useState(25)
  const [totalEmails, setTotalEmails] = useState(0)
  const [busqueda, setBusqueda] = useState('')
  const [busquedaAplicada, setBusquedaAplicada] = useState('')
  const [nuevoEmail, setNuevoEmail] = useState('')
  const [nuevoRole, setNuevoRole] = useState<Role>('solicitante')
  const [nuevaArea, setNuevaArea] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resultadoCsv, setResultadoCsv] = useState<string | null>(null)
  const [cargandoCsv, setCargandoCsv] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [editandoEmail, setEditandoEmail] = useState<string | null>(null)
  const [editRole, setEditRole] = useState<Role>('solicitante')
  const [editAreaId, setEditAreaId] = useState('')

  const [reenviando, setReenviando] = useState<string | null>(null)
  const [enviandoBienvenida, setEnviandoBienvenida] = useState<string | null>(null)
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [enviandoSeleccionados, setEnviandoSeleccionados] = useState(false)
  const [enviandoInvitaciones, setEnviandoInvitaciones] = useState(false)
  const [mensajeMasivo, setMensajeMasivo] = useState<{ texto: string; tipo: 'exito' | 'error' } | null>(null)
  const [emailPorEliminar, setEmailPorEliminar] = useState<string | null>(null)
  const [eliminando, setEliminando] = useState(false)
  const [emailPorRevocar, setEmailPorRevocar] = useState<string | null>(null)
  const [revocando, setRevocando] = useState(false)
  const [mensajeAccion, setMensajeAccion] = useState<{ email: string; texto: string; tipo: 'exito' | 'error' } | null>(null)
  const [actualizando, setActualizando] = useState(false)
  const [emailParaPassword, setEmailParaPassword] = useState<string | null>(null)
  const [asignandoPassword, setAsignandoPassword] = useState(false)
  const [errorPassword, setErrorPassword] = useState<string | null>(null)
  const [passwordAsignada, setPasswordAsignada] = useState<string | null>(null)
  const cargaInicialRef = useRef(true)
  const cargaIdRef = useRef(0)

  const cargar = useCallback(async () => {
    const cargaId = ++cargaIdRef.current
    if (cargaInicialRef.current) setLoading(true)
    else setActualizando(true)
    const offset = pagina * limite
    let consultaSolicitantes = supabase
      .from('allowed_emails')
      .select('*', { count: 'exact' })
      .eq('role', 'solicitante')
      .order('invited_at', { ascending: false, nullsFirst: true })
      .order('email', { ascending: true })
    if (busquedaAplicada) {
      consultaSolicitantes = consultaSolicitantes.ilike('email', `%${busquedaAplicada}%`)
    }

    const cargarEquipoCompleto = async () => {
      const equipo: AllowedEmail[] = []
      let desde = 0

      while (true) {
        let consulta = supabase
          .from('allowed_emails')
          .select('*')
          .in('role', ['admin', 'agente'])
          .order('role', { ascending: true })
          .order('email', { ascending: true })

        if (busquedaAplicada) consulta = consulta.ilike('email', `%${busquedaAplicada}%`)

        const resultado = await consulta.range(desde, desde + TAMANO_BLOQUE_EQUIPO - 1)
        if (resultado.error) return { equipo, error: true }

        const bloque = (resultado.data ?? []) as AllowedEmail[]
        equipo.push(...bloque)
        if (bloque.length < TAMANO_BLOQUE_EQUIPO) return { equipo, error: false }
        desde += TAMANO_BLOQUE_EQUIPO
      }
    }

    const [resultadoEquipo, resultadoSolicitantes] = await Promise.all([
      cargarEquipoCompleto(),
      consultaSolicitantes.range(offset, offset + limite - 1),
    ])
    if (cargaId !== cargaIdRef.current) return

    const registros = [...resultadoEquipo.equipo, ...(resultadoSolicitantes.data ?? [])]
    setEmails(registros)
    setTotalEmails(resultadoSolicitantes.count ?? 0)
    if (resultadoEquipo.error || resultadoSolicitantes.error) setError('No se pudo cargar la whitelist.')
    cargaInicialRef.current = false
    setLoading(false)
    setActualizando(false)
  }, [busquedaAplicada, limite, pagina])

  useEffect(() => {
    const timeout = setTimeout(() => {
      setPagina(0)
      setBusquedaAplicada(busqueda.trim().toLowerCase())
    }, 300)
    return () => clearTimeout(timeout)
  }, [busqueda])

  useEffect(() => {
    setSeleccionados(new Set())
    setMensajeMasivo(null)
    void cargar()
  }, [cargar])

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
    void cargar()
  }

  async function handleCsv(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCargandoCsv(true)
    setError(null)
    setResultadoCsv(null)

    try {
      const texto = await file.text()
      const lineas = texto.split(/\r?\n/).map((linea) => linea.trim()).filter(Boolean)
      const separador = (lineas[0]?.match(/;/g)?.length ?? 0) > (lineas[0]?.match(/,/g)?.length ?? 0) ? ';' : ','
      const limpiar = (valor = '') => valor.trim().replace(/^['"]|['"]$/g, '')
      const rolesValidos = new Set<Role>(['admin', 'agente', 'solicitante'])
      let filasInvalidas = 0
      let areasNoEncontradas = 0

      const registros = lineas
        .filter((linea, indice) => {
          if (indice !== 0) return true
          const primeraColumna = limpiar(linea.split(separador)[0]).toLowerCase()
          return primeraColumna !== 'correo' && primeraColumna !== 'email'
        })
        .map((linea) => linea.split(separador).map(limpiar))
        .map(([emailOriginal, roleOriginal, areaNombre]) => {
          const email = emailOriginal?.toLowerCase()
          const role = (roleOriginal?.toLowerCase() || 'solicitante') as Role
          if (!email || !email.includes('@') || !rolesValidos.has(role)) {
            filasInvalidas += 1
            return null
          }

          const area = areaNombre
            ? areas.find((item) => item.nombre.toLowerCase() === areaNombre.toLowerCase())
            : null
          if (areaNombre && !area) areasNoEncontradas += 1

          return { email, role, area_id: area?.id ?? null }
        })
        .filter((registro): registro is { email: string; role: Role; area_id: string | null } => registro !== null)

      const unicos = [...new Map(registros.map((registro) => [registro.email, registro])).values()]
      if (unicos.length === 0) {
        setError('El archivo no contiene correos válidos. Descarga la plantilla y revisa el formato.')
        return
      }

      const { error: errorCarga } = await supabase.from('allowed_emails').upsert(unicos)
      if (errorCarga) {
        setError(`No se pudo cargar el archivo: ${errorCarga.message}`)
        return
      }

      const detalles = [
        `${unicos.length} correo${unicos.length === 1 ? '' : 's'} cargado${unicos.length === 1 ? '' : 's'}`,
        filasInvalidas > 0 ? `${filasInvalidas} fila${filasInvalidas === 1 ? '' : 's'} inválida${filasInvalidas === 1 ? '' : 's'} omitida${filasInvalidas === 1 ? '' : 's'}` : '',
        areasNoEncontradas > 0 ? `${areasNoEncontradas} área${areasNoEncontradas === 1 ? '' : 's'} no encontrada${areasNoEncontradas === 1 ? '' : 's'} (quedó sin definir)` : '',
      ].filter(Boolean)
      setResultadoCsv(`${detalles.join(' · ')}.`)
      if (pagina !== 0) setPagina(0)
      else await cargar()
    } catch {
      setError('No se pudo leer el archivo. Verifica que sea un CSV válido.')
    } finally {
      setCargandoCsv(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
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
      setMensajeAccion({ email, texto: 'No se pudo guardar el cambio.', tipo: 'error' })
      return
    }

    const registro = emails.find((e) => e.email === email)
    if (registro?.used_at) {
      const { error: errorPerfil } = await supabase
        .from('profiles')
        .update({ role: editRole, area_id: editAreaId || null })
        .eq('email', email)

      if (errorPerfil) {
        setMensajeAccion({ email, texto: 'Se guardó en la whitelist pero no se pudo actualizar el perfil activo.', tipo: 'error' })
        setEditandoEmail(null)
        void cargar()
        return
      }
    }

    setEditandoEmail(null)
    void cargar()
  }

  async function eliminarCorreo(email: string) {
    setEliminando(true)
    setError(null)
    const { error } = await supabase.functions.invoke('revoke-user', { body: { email } })
    setEliminando(false)
    if (error) {
      setError('No se pudo eliminar el acceso. Intenta nuevamente.')
      setEmailPorEliminar(null)
      return
    }
    setSeleccionados((actuales) => {
      const siguientes = new Set(actuales)
      siguientes.delete(email)
      return siguientes
    })
    setResultadoCsv(`Se eliminó el acceso de ${email}. Si tenía una cuenta registrada, también quedó bloqueada.`)
    setMensajeMasivo(null)
    setEmailPorEliminar(null)
    if (emails.length === 1 && pagina > 0) setPagina((actual) => actual - 1)
    else void cargar()
  }

  async function revocarAcceso(email: string) {
    setRevocando(true)
    setError(null)
    const { error: errorRevocacion } = await supabase.functions.invoke('revoke-user', { body: { email } })
    setRevocando(false)
    setEmailPorRevocar(null)
    if (errorRevocacion) {
      setError('No se pudo revocar el acceso. Verifica que el correo tenga una cuenta registrada.')
      return
    }
    setResultadoCsv(`Se revocó el acceso de ${email}. Sus tareas históricas se conservaron.`)
    setSeleccionados((actuales) => {
      const siguientes = new Set(actuales)
      siguientes.delete(email)
      return siguientes
    })
    void cargar()
  }

  async function reenviarCorreo(email: string) {
    setReenviando(email)
    setMensajeAccion(null)
    const { error } = await supabase.functions.invoke('invite-user', { body: { email } })
    setReenviando(null)
    if (error) {
      const texto = await mensajeDeErrorFuncion(error, 'No se pudo reenviar. Intenta de nuevo.')
      setMensajeAccion({ email, texto, tipo: 'error' })
    } else {
      setMensajeAccion({ email, texto: 'Correo reenviado.', tipo: 'exito' })
    }
    void cargar()
  }

  async function enviarBienvenida(email: string) {
    setEnviandoBienvenida(email)
    setMensajeAccion(null)
    const { error } = await supabase.functions.invoke('send-welcome-email', { body: { email } })
    setEnviandoBienvenida(null)
    if (error) {
      const texto = await mensajeDeErrorFuncion(error, 'No se pudo enviar la bienvenida.')
      setMensajeAccion({ email, texto, tipo: 'error' })
    } else {
      setMensajeAccion({ email, texto: 'Bienvenida enviada.', tipo: 'exito' })
    }
  }

  function abrirAsignarPassword(email: string) {
    setEmailParaPassword(email)
    setErrorPassword(null)
    setPasswordAsignada(null)
  }

  function cerrarAsignarPassword() {
    setEmailParaPassword(null)
    setErrorPassword(null)
    setPasswordAsignada(null)
  }

  async function confirmarAsignarPassword(password: string) {
    if (!emailParaPassword) return
    setAsignandoPassword(true)
    setErrorPassword(null)
    const { error } = await supabase.functions.invoke('admin-set-password', {
      body: { email: emailParaPassword, password },
    })
    setAsignandoPassword(false)
    if (error) {
      setErrorPassword(await mensajeDeErrorFuncion(error, 'No se pudo asignar la contraseña.'))
      return
    }
    setPasswordAsignada(password)
    void cargar()
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
    const destinos = emails.filter((email) => email.used_at && seleccionados.has(email.email)).map((email) => email.email)
    if (destinos.length === 0) return
    setEnviandoSeleccionados(true)
    setMensajeMasivo(null)

    const resultados: { email: string; error: unknown }[] = []
    for (let indice = 0; indice < destinos.length; indice += 5) {
      const lote = await Promise.all(destinos.slice(indice, indice + 5).map(async (email) => {
        const { error } = await supabase.functions.invoke('send-welcome-email', { body: { email } })
        return { email, error }
      }))
      resultados.push(...lote)
    }
    const fallidos = resultados.filter((resultado) => resultado.error)

    setEnviandoSeleccionados(false)
    if (fallidos.length === 0) {
      setMensajeMasivo({ texto: `Se enviaron ${destinos.length} correo${destinos.length === 1 ? '' : 's'} de bienvenida.`, tipo: 'exito' })
      setSeleccionados(new Set())
    } else {
      const motivo = await mensajeDeErrorFuncion(fallidos[0].error, 'motivo desconocido')
      setMensajeMasivo({
        texto: `Se enviaron ${destinos.length - fallidos.length} de ${destinos.length}. ${fallidos[0].email} falló: ${motivo}${fallidos.length > 1 ? ` (y ${fallidos.length - 1} más)` : ''}.`,
        tipo: 'error',
      })
      setSeleccionados(new Set(fallidos.map((resultado) => resultado.email)))
    }
  }

  async function enviarInvitacionesSeleccionadas() {
    const destinos = emails.filter((email) => !email.used_at && seleccionados.has(email.email)).map((email) => email.email)
    if (destinos.length === 0) return
    setEnviandoInvitaciones(true)
    setMensajeMasivo(null)

    const resultados: { email: string; error: unknown }[] = []
    for (let indice = 0; indice < destinos.length; indice += 5) {
      const lote = await Promise.all(destinos.slice(indice, indice + 5).map(async (email) => {
        const { error } = await supabase.functions.invoke('invite-user', { body: { email } })
        return { email, error }
      }))
      resultados.push(...lote)
    }
    const fallidos = resultados.filter((resultado) => resultado.error)

    setEnviandoInvitaciones(false)
    if (fallidos.length === 0) {
      setMensajeMasivo({ texto: `Se enviaron ${destinos.length} invitación${destinos.length === 1 ? '' : 'es'}.`, tipo: 'exito' })
      setSeleccionados(new Set())
    } else {
      const motivo = await mensajeDeErrorFuncion(fallidos[0].error, 'motivo desconocido')
      setMensajeMasivo({
        texto: `Se enviaron ${destinos.length - fallidos.length} de ${destinos.length}. ${fallidos[0].email} falló: ${motivo}${fallidos.length > 1 ? ` (y ${fallidos.length - 1} más)` : ''}.`,
        tipo: 'error',
      })
      setSeleccionados(new Set(fallidos.map((resultado) => resultado.email)))
    }
    void cargar()
  }

  const pendientesSeleccionados = emails.filter((email) => !email.used_at && seleccionados.has(email.email)).length
  const registradosSeleccionados = emails.filter((email) => email.used_at && seleccionados.has(email.email)).length
  const todosPaginaSeleccionados = emails.length > 0 && emails.every((email) => seleccionados.has(email.email))
  const totalPaginas = Math.max(1, Math.ceil(totalEmails / limite))

  function alternarPaginaCompleta() {
    setSeleccionados(todosPaginaSeleccionados ? new Set() : new Set(emails.map((email) => email.email)))
    setMensajeMasivo(null)
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
            disabled={enviandoSeleccionados || enviandoInvitaciones}
            onChange={() => alternarSeleccion(e.email)}
            title={e.used_at ? 'Seleccionar para enviar bienvenida' : 'Seleccionar para enviar invitación'}
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
            <span className={`rol-badge rol-badge--${e.role}`}>{etiquetaRol(e.role)}</span>
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
                <RowActionsMenu>
                  {!e.used_at && (
                    <button
                      type="button"
                      className="row-menu__item"
                      role="menuitem"
                      onClick={() => reenviarCorreo(e.email)}
                      disabled={reenviando === e.email || enviandoInvitaciones}
                    >
                      {reenviando === e.email ? 'Enviando...' : 'Reenviar correo'}
                    </button>
                  )}
                  {e.used_at && (
                    <button
                      type="button"
                      className="row-menu__item"
                      role="menuitem"
                      onClick={() => enviarBienvenida(e.email)}
                      disabled={enviandoBienvenida === e.email || enviandoSeleccionados || enviandoInvitaciones}
                    >
                      {enviandoBienvenida === e.email ? 'Enviando...' : 'Enviar bienvenida'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="row-menu__item"
                    role="menuitem"
                    onClick={() => abrirAsignarPassword(e.email)}
                    title="Asignarle una contraseña directamente, sin enviar correo"
                  >
                    Asignar contraseña
                  </button>
                  <div className="row-menu__separador" role="separator" />
                  {e.used_at ? (
                    <button
                      type="button"
                      className="row-menu__item row-menu__item--peligro"
                      role="menuitem"
                      onClick={() => setEmailPorRevocar(e.email)}
                    >
                      Revocar acceso
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="row-menu__item row-menu__item--peligro"
                      role="menuitem"
                      onClick={() => setEmailPorEliminar(e.email)}
                    >
                      Eliminar
                    </button>
                  )}
                </RowActionsMenu>
              </>
            )}
            {mensajeAccion?.email === e.email && (
              <span className={`admin-table__mensaje admin-table__mensaje--${mensajeAccion.tipo}`} role="status">
                {mensajeAccion.texto}
              </span>
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
        <p className="auth-hint">Solo los correos aquí listados pueden solicitar acceso en /solicitar-acceso.</p>
      </div>

      <form className="admin-toolbar" onSubmit={agregarCorreo}>
        <h2 className="admin-toolbar__titulo">Agregar acceso</h2>
        <div className="admin-toolbar__fila">
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
          <button type="submit">Agregar correo</button>
        </div>
        <div className="admin-toolbar__csv-fila">
          <label className="admin-toolbar__csv">
            {cargandoCsv ? 'Cargando...' : 'Cargar CSV'}
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleCsv} disabled={cargandoCsv} />
          </label>
          <span className="admin-toolbar__csv-formato">
            Formato: <code>correo,rol,area</code>
          </span>
          <a className="admin-toolbar__plantilla" href="/whitelist-ejemplo.csv" download>
            Descargar ejemplo
          </a>
        </div>
      </form>

      {error && <p className="auth-error">{error}</p>}
      {resultadoCsv && <p className="auth-success" role="status">{resultadoCsv}</p>}

      <div className="admin-busqueda">
        <label>
          Buscar persona por correo
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="jguzman@netcol.net.co"
          />
        </label>
        {actualizando && <span className="admin-busqueda__estado">Actualizando…</span>}
        {busqueda.trim().includes('@') && (
          <button type="button" className="admin-table__accion-eliminar" onClick={() => setEmailPorRevocar(busqueda.trim().toLowerCase())}>
            Revocar este correo
          </button>
        )}
      </div>

      <div className="admin-envio-bienvenida">
        <div>
          <strong>Envíos masivos</strong>
          <span>Las personas pendientes reciben su invitación; las registradas reciben la bienvenida.</span>
        </div>
        <button type="button" className="admin-envio-bienvenida__secundario" onClick={alternarPaginaCompleta} disabled={enviandoSeleccionados || enviandoInvitaciones || emails.length === 0}>
          {todosPaginaSeleccionados ? 'Quitar selección' : 'Seleccionar página'}
        </button>
        <button
          type="button"
          onClick={enviarInvitacionesSeleccionadas}
          disabled={pendientesSeleccionados === 0 || enviandoInvitaciones || enviandoSeleccionados}
        >
          {enviandoInvitaciones ? 'Enviando...' : `Enviar invitación (${pendientesSeleccionados})`}
        </button>
        <button
          type="button"
          onClick={enviarBienvenidasSeleccionadas}
          disabled={registradosSeleccionados === 0 || enviandoSeleccionados || enviandoInvitaciones}
        >
          {enviandoSeleccionados
            ? 'Enviando...'
            : `Enviar bienvenida (${registradosSeleccionados})`}
        </button>
        {mensajeMasivo && (
          <span className={`admin-envio-bienvenida__mensaje admin-envio-bienvenida__mensaje--${mensajeMasivo.tipo}`} role="status">
            {mensajeMasivo.texto}
          </span>
        )}
      </div>

      <div className="admin-panels">
        {renderPanel('Administradores', emails.filter((e) => e.role === 'admin'))}
        {renderPanel('Agentes', emails.filter((e) => e.role === 'agente'))}
        {renderPanel('Solicitantes', emails.filter((e) => e.role === 'solicitante'))}
      </div>

      <div className="admin-paginacion">
        <span>
          {totalEmails === 0 ? 'Sin solicitantes' : `Solicitantes ${pagina * limite + 1}–${Math.min((pagina + 1) * limite, totalEmails)} de ${totalEmails}`}
        </span>
        <label>
          Solicitantes por página
          <select
            value={limite}
            onChange={(e) => {
              setLimite(Number(e.target.value))
              setPagina(0)
            }}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
        <div className="admin-paginacion__acciones">
          <button type="button" className="admin-table__accion-secundaria" onClick={() => setPagina((actual) => actual - 1)} disabled={pagina === 0}>
            Anterior
          </button>
          <span>Página {pagina + 1} de {totalPaginas}</span>
          <button type="button" className="admin-table__accion-secundaria" onClick={() => setPagina((actual) => actual + 1)} disabled={pagina + 1 >= totalPaginas}>
            Siguiente
          </button>
        </div>
      </div>

      <ConfirmDialog
        abierto={emailPorEliminar !== null}
        titulo="Eliminar acceso"
        descripcion={`¿Quieres eliminar el acceso de ${emailPorEliminar ?? ''}? Si ya tiene una cuenta, también quedará bloqueada. Sus tareas históricas se conservarán.`}
        textoConfirmar="Eliminar acceso"
        procesando={eliminando}
        onCancelar={() => setEmailPorEliminar(null)}
        onConfirmar={() => emailPorEliminar && eliminarCorreo(emailPorEliminar)}
      />
      <ConfirmDialog
        abierto={emailPorRevocar !== null}
        titulo="Revocar acceso"
        descripcion={`¿Quieres revocar el acceso de ${emailPorRevocar ?? ''}? Ya no podrá iniciar sesión, pero sus tareas históricas se conservarán.`}
        textoConfirmar="Revocar acceso"
        procesando={revocando}
        onCancelar={() => setEmailPorRevocar(null)}
        onConfirmar={() => emailPorRevocar && revocarAcceso(emailPorRevocar)}
      />
      <SetPasswordDialog
        email={emailParaPassword}
        procesando={asignandoPassword}
        error={errorPassword}
        contrasenaAsignada={passwordAsignada}
        onConfirmar={confirmarAsignarPassword}
        onCerrar={cerrarAsignarPassword}
      />
    </div>
  )
}
