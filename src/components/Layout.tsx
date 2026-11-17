import { Fragment } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useArea } from '../context/AreaContext'
import { CompletarPerfilForm } from './CompletarPerfilForm'
import { Avatar } from './Avatar'
import { CentroNotificaciones } from './CentroNotificaciones'
import { AvisoNovedades } from './AvisoNovedades'

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
          <CentroNotificaciones />
          {profile && <Avatar nombre={profile.full_name ?? profile.email} />}
          <span className="app-header__user-nombre">{profile?.full_name ?? profile?.email}</span>
          <NavLink to="/configuracion" className="app-header__config" title="Configuración" aria-label="Configuración">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </NavLink>
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
      <footer className="app-firma">by Santiago Garcia</footer>
      <AvisoNovedades />
    </div>
  )
}
