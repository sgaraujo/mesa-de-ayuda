import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/database'

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
  refrescarPerfil: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [sesionLista, setSesionLista] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSesionLista(true)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setSesionLista(true)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id

  async function cargarPerfil(id: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', id).single()
    setProfile(data ?? null)
  }

  // Esperamos a que getSession() resuelva antes de decidir si hay perfil o no:
  // si apagábamos loading en cuanto userId era undefined (estado inicial),
  // ProtectedRoute redirigía un instante a /login y luego de vuelta al tablero,
  // duplicando la carga de chunks lazy en cada entrada a la plataforma.
  useEffect(() => {
    if (!sesionLista) return

    let cancelled = false

    if (!userId) {
      setProfile(null)
      setLoading(false)
      return
    }

    setLoading(true)
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
      .then(async ({ data }) => {
        if (!cancelled) {
          if (data?.activo === false) {
            await supabase.auth.signOut({ scope: 'local' })
            setSession(null)
            setProfile(null)
            setLoading(false)
            return
          }
          setProfile(data ?? null)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [userId, sesionLista])

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function refrescarPerfil() {
    if (userId) await cargarPerfil(userId)
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, signOut, refrescarPerfil }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
