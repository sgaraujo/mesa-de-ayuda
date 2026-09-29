import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useArea } from '../context/AreaContext'
import type { RolArea } from '../types/database'

interface ProtectedRouteProps {
  // Roles permitidos en el área activa (el superadmin cuenta como líder).
  rolesPermitidos?: RolArea[]
  soloSuperadmin?: boolean
  // Líder de al menos un área (no necesariamente la activa).
  liderDeAlgunArea?: boolean
}

export function ProtectedRoute({ rolesPermitidos, soloSuperadmin, liderDeAlgunArea }: ProtectedRouteProps) {
  const { session, loading } = useAuth()
  const { areas, areaActiva, esSuperadmin, loading: cargandoAreas } = useArea()
  const necesitaAreas = Boolean(rolesPermitidos || soloSuperadmin || liderDeAlgunArea)

  if (loading || (necesitaAreas && cargandoAreas)) return <div className="pantalla-carga">Cargando...</div>
  if (!session) return <Navigate to="/login" replace />
  if (soloSuperadmin && !esSuperadmin) return <Navigate to="/nueva-solicitud" replace />
  if (liderDeAlgunArea && !areas.some((a) => a.rol === 'lider')) return <Navigate to="/nueva-solicitud" replace />
  if (rolesPermitidos && (!areaActiva || !rolesPermitidos.includes(areaActiva.rol))) {
    return <Navigate to="/nueva-solicitud" replace />
  }

  return <Outlet />
}
