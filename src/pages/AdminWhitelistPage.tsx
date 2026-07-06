import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAreas } from '../hooks/useAreas'
import { esDominioPermitido } from '../lib/dominio'
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

  async function cargar() {
    setLoading(true)
    const { data } = await supabase
      .from('allowed_emails')
      .select('*')
      .order('invited_at', { ascending: false })
    setEmails(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  async function agregarCorreo(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const email = nuevoEmail.trim().toLowerCase()

    if (!esDominioPermitido(email)) {
      setError('El correo debe pertenecer a inteegra.net.co, triangulum.net.co o netcol.net.co.')
      return
    }

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
      .filter((r) => r.email && esDominioPermitido(r.email))

    if (registros.length > 0) {
      await supabase.from('allowed_emails').upsert(registros)
      cargar()
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  if (loading) return <div className="pantalla-carga">Cargando whitelist...</div>

  return (
    <div className="admin-page">
      <h1>Whitelist de correos autorizados</h1>
      <p className="auth-hint">
        Solo los correos aquí listados pueden solicitar acceso en /solicitar-acceso. CSV esperado:
        <code> correo,rol,area</code> (rol: admin, agente o solicitante).
      </p>

      <form className="admin-form" onSubmit={agregarCorreo}>
        <label>
          Correo
          <input
            type="email"
            required
            value={nuevoEmail}
            onChange={(e) => setNuevoEmail(e.target.value)}
            placeholder="nombre@netcol.net.co"
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
        <button type="submit">Agregar</button>
        <label>
          Cargar CSV
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCsv} />
        </label>
      </form>

      {error && <p className="auth-error">{error}</p>}

      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Correo</th>
              <th>Rol</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {emails.map((e) => (
              <tr key={e.email}>
                <td>{e.email}</td>
                <td>{e.role}</td>
                <td>
                  <span className={`badge ${e.used_at ? 'badge--usado' : 'badge--pendiente'}`}>
                    {e.used_at ? 'Registrado' : 'Pendiente'}
                  </span>
                </td>
              </tr>
            ))}
            {emails.length === 0 && (
              <tr>
                <td colSpan={3} className="chart-card__vacio">
                  Sin correos cargados todavía
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
