import { lazy, Suspense, type ComponentType } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/Layout'

// Tras un nuevo despliegue, los nombres de los archivos (hash) cambian. Si el
// navegador tenía la app abierta desde antes, al navegar a una ruta que carga
// su código bajo demanda intenta pedir un archivo que ya no existe y Vercel
// responde con el index.html en su lugar (de ahí el error de MIME type).
// Recargamos la página una sola vez para traer la versión más reciente.
const CHUNK_RELOAD_KEY = 'chunk-reload-intentado'

function lazyConReintento<T extends { default: ComponentType<unknown> }>(factory: () => Promise<T>) {
  return lazy(async () => {
    try {
      const modulo = await factory()
      sessionStorage.removeItem(CHUNK_RELOAD_KEY)
      return modulo
    } catch (err) {
      if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
        window.location.reload()
        return new Promise<T>(() => {})
      }
      throw err
    }
  })
}

const LoginPage = lazyConReintento(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })))
const RequestAccessPage = lazyConReintento(() => import('./pages/RequestAccessPage').then((m) => ({ default: m.RequestAccessPage })))
const CreatePasswordPage = lazyConReintento(() => import('./pages/CreatePasswordPage').then((m) => ({ default: m.CreatePasswordPage })))
const NewTicketPage = lazyConReintento(() => import('./pages/NewTicketPage').then((m) => ({ default: m.NewTicketPage })))
const BoardPage = lazyConReintento(() => import('./pages/BoardPage').then((m) => ({ default: m.BoardPage })))
const StatsPage = lazyConReintento(() => import('./pages/StatsPage').then((m) => ({ default: m.StatsPage })))
const AdminWhitelistPage = lazyConReintento(() => import('./pages/AdminWhitelistPage').then((m) => ({ default: m.AdminWhitelistPage })))

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
