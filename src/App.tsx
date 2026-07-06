import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { RequestAccessPage } from './pages/RequestAccessPage'
import { CreatePasswordPage } from './pages/CreatePasswordPage'
import { NewTicketPage } from './pages/NewTicketPage'
import { BoardPage } from './pages/BoardPage'
import { StatsPage } from './pages/StatsPage'
import { AdminWhitelistPage } from './pages/AdminWhitelistPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/solicitar-acceso" element={<RequestAccessPage />} />
          <Route path="/crear-password" element={<CreatePasswordPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/nueva-solicitud" element={<NewTicketPage />} />

              <Route element={<ProtectedRoute rolesPermitidos={['agente', 'admin']} />}>
                <Route path="/tablero" element={<BoardPage />} />
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
      </AuthProvider>
    </BrowserRouter>
  )
}
