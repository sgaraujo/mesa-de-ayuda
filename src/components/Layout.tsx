import { Fragment } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useArea } from '../context/AreaContext'
import { CompletarPerfilForm } from './CompletarPerfilForm'
import { Avatar } from './Avatar'

export function Layout() {
  const { profile, signOut } = useAuth()
  const { areas, areaActiva, seleccionarArea, esSuperadmin, loading: cargandoAreas } = useArea()
  const rol = areaActiva?.rol
  const esGestor = rol === 'agente' || rol === 'lider'

  if (profile && (!profile.full_name || !profile.area_id)) {
    return <CompletarPerfilForm />
  }

  if (cargandoAreas) return <div className="pantalla-carga">Cargando...</div>

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          Mesa de Ayuda
        </div>
        {areas.length > 1 ? (
          <label className="app-header__area">
            <span className="app-header__area-etiqueta">Área</span>
            <select
              value={areaActiva?.id ?? ''}
              onChange={(e) => seleccionarArea(e.target.value)}
              aria-label="Cambiar de área"
            >
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.nombre}
                </option>
              ))}
            </select>
          </label>
        ) : (
          areaActiva && (
            <span className="app-header__area app-header__area--fija">
              <span className="app-header__area-etiqueta">Área</span>
              {areaActiva.nombre}
            </span>
          )
        )}
        <nav className="app-nav">
          <NavLink to="/nueva-solicitud">Nueva solicitud</NavLink>
          <NavLink to="/mis-solicitudes">Mis solicitudes</NavLink>
          {esGestor && <NavLink to="/tablero">Tablero</NavLink>}
          {esGestor && <NavLink to="/estadisticas">Estadísticas</NavLink>}
          {areas.some((a) => a.rol === 'lider') && <NavLink to="/grupos">Grupos</NavLink>}
          {esSuperadmin && <NavLink to="/admin/whitelist">Whitelist</NavLink>}
        </nav>
        <div className="app-header__user">
          {profile && <Avatar nombre={profile.full_name ?? profile.email} />}
          <span className="app-header__user-nombre">{profile?.full_name ?? profile?.email}</span>
          <button type="button" className="app-header__salir" onClick={signOut} title="Cerrar sesión">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" />
            </svg>
            Salir
          </button>
        </div>
      </header>
      <main className="app-content">
        {/* La key remonta la página al cambiar de área: filtros, datos y canal
            de realtime arrancan limpios para el tablero nuevo. Sin área (nadie
            lo ha agregado a una) igual puede enviar y seguir solicitudes. */}
        <Fragment key={areaActiva?.id ?? 'sin-area'}>
          <Outlet />
        </Fragment>
      </main>
    </div>
  )
}
