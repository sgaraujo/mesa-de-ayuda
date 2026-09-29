import { Fragment } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useArea } from '../context/AreaContext'
import { CompletarPerfilForm } from './CompletarPerfilForm'

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
          <span className="app-header__logo-dot" aria-hidden="true" />
          Mesa de Ayuda
        </div>
        {areas.length > 1 ? (
          <select
            className="app-header__area"
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
        ) : (
          areaActiva && <span className="app-header__area-nombre">{areaActiva.nombre}</span>
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
          <span>{profile?.full_name ?? profile?.email}</span>
          <button onClick={signOut}>Salir</button>
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
