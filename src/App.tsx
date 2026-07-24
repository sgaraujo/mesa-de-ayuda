import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'

const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })))
const RequestAccessPage = lazy(() => import('./pages/RequestAccessPage').then((m) => ({ default: m.RequestAccessPage })))
const CreatePasswordPage = lazy(() => import('./pages/CreatePasswordPage').then((m) => ({ default: m.CreatePasswordPage })))
const NewTicketPage = lazy(() => import('./pages/NewTicketPage').then((m) => ({ default: m.NewTicketPage })))
const BoardPage = lazy(() => import('./pages/BoardPage').then((m) => ({ default: m.BoardPage })))
const StatsPage = lazy(() => import('./pages/StatsPage').then((m) => ({ default: m.StatsPage })))
const AdminWhitelistPage = lazy(() => import('./pages/AdminWhitelistPage').then((m) => ({ default: m.AdminWhitelistPage })))

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<div className="pantalla-carga">Cargando...</div>}>
          <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/solicitar-acceso" element={<RequestAccessPage />} />
          <Route path="/crear-password" element={<CreatePasswordPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/nueva-solicitud" element={<NewTicketPage />} />

              <Route path="/tablero" element={<BoardPage />} />

              <Route element={<ProtectedRoute rolesPermitidos={['agente', 'admin']} />}>
                <Route path="/estadisticas" element={<StatsPage />} />
              </Route>

              <Route element={<ProtectedRoute rolesPermitidos={['admin']} />}>
                <Route path="/admin/whitelist" element={<AdminWhitelistPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="/" element={<Navigate to="/nueva-solicitud" replace />} />
          <Route path="*" element={<Navigate to="/nueva-solicitud" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
