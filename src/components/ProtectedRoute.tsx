import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useArea } from '../context/AreaContext'
import type { RolArea } from '../types/database'

interface ProtectedRouteProps {
  // Roles permitidos en el área activa (el superadmin cuenta como admin).
  rolesPermitidos?: RolArea[]
  soloSuperadmin?: boolean
}

export function ProtectedRoute({ rolesPermitidos, soloSuperadmin }: ProtectedRouteProps) {
  const { session, loading } = useAuth()
  const { areaActiva, esSuperadmin, loading: cargandoAreas } = useArea()
  const necesitaAreas = Boolean(rolesPermitidos || soloSuperadmin)

  if (loading || (necesitaAreas && cargandoAreas)) return <div className="pantalla-carga">Cargando...</div>
  if (!session) return <Navigate to="/login" replace />
  if (soloSuperadmin && !esSuperadmin) return <Navigate to="/nueva-solicitud" replace />
  if (rolesPermitidos && (!areaActiva || !rolesPermitidos.includes(areaActiva.rol))) {
    return <Navigate to="/nueva-solicitud" replace />
  }

  return <Outlet />
}
