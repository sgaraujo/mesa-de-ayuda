import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { CompletarPerfilForm } from './CompletarPerfilForm'

export function Layout() {
  const { profile, signOut } = useAuth()
  const esAgenteOAdmin = profile?.role === 'agente' || profile?.role === 'admin'

  if (profile && (!profile.full_name || !profile.area_id)) {
    return <CompletarPerfilForm />
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__logo-dot" aria-hidden="true" />
          Mesa de Ayuda
        </div>
        <nav className="app-nav">
          <NavLink to="/nueva-solicitud">Nueva solicitud</NavLink>
          {esAgenteOAdmin && <NavLink to="/tablero">Tablero</NavLink>}
          {esAgenteOAdmin && <NavLink to="/estadisticas">Estadísticas</NavLink>}
          {profile?.role === 'admin' && <NavLink to="/admin/whitelist">Whitelist</NavLink>}
        </nav>
        <div className="app-header__user">
          <span>{profile?.full_name ?? profile?.email}</span>
          <button onClick={signOut}>Salir</button>
        </div>
      </header>
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}
