import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import type { Role } from '../types/database'

interface ProtectedRouteProps {
  rolesPermitidos?: Role[]
}

export function ProtectedRoute({ rolesPermitidos }: ProtectedRouteProps) {
  const { session, profile, loading } = useAuth()

  if (loading) return <div className="pantalla-carga">Cargando...</div>
  if (!session) return <Navigate to="/login" replace />
  if (rolesPermitidos && profile && !rolesPermitidos.includes(profile.role)) {
    return <Navigate to="/nueva-solicitud" replace />
  }

  return <Outlet />
}
