import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useArea } from '../context/AreaContext'
import { MiembrosArea } from '../components/MiembrosArea'
import type { MiembroArea } from '../hooks/useMiembrosArea'
import type { Profile, RolArea, Ticket } from '../types/database'

const ROLES_EN_ORDEN: { rol: RolArea; titulo: string }[] = [
  { rol: 'lider', titulo: 'Líderes' },
  { rol: 'agente', titulo: 'Agentes' },
]

type TicketResumen = Pick<Ticket, 'area_id' | 'estado' | 'asignado_a' | 'es_grupal'>

interface ResumenTablero {
  sinAsignar: number
  pendiente: number
  enCurso: number
  finalizado: number
}

function resumir(tickets: TicketResumen[]): ResumenTablero {
  const resumen: ResumenTablero = { sinAsignar: 0, pendiente: 0, enCurso: 0, finalizado: 0 }
  for (const t of tickets) {
    if (t.estado === 'finalizado') resumen.finalizado++
    else if (!t.es_grupal && t.asignado_a === null) resumen.sinAsignar++
    else if (t.estado === 'en_curso') resumen.enCurso++
    else resumen.pendiente++
  }
  return resumen
}

function iniciales(nombre: string): string {
  return nombre
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]!.toUpperCase())
    .join('')
}

// Vista de todos los grupos (áreas) que la persona lidera: quiénes están
// en cada uno, cómo va su tablero y acceso directo a él. El superadmin ve
// todas las áreas.
export function GruposPage() {
  const navigate = useNavigate()
  const { areas, areaActiva, seleccionarArea } = useArea()
  const areasLider = useMemo(() => areas.filter((a) => a.rol === 'lider'), [areas])
  const idsAreas = useMemo(() => areasLider.map((a) => a.id), [areasLider])

  const [miembrosPorArea, setMiembrosPorArea] = useState<Map<string, MiembroArea[]>>(new Map())
  const [ticketsPorArea, setTicketsPorArea] = useState<Map<string, TicketResumen[]>>(new Map())
  const [perfiles, setPerfiles] = useState<Pick<Profile, 'id' | 'full_name' | 'email'>[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [gestionando, setGestionando] = useState<string | null>(null)

  const cargarMiembros = useCallback(async () => {
    if (idsAreas.length === 0) return
    const { data } = await supabase
      .from('area_miembros')
      .select('area_id, rol, profile:profiles(*)')
      .in('area_id', idsAreas)
    const porArea = new Map<string, MiembroArea[]>()
    for (const fila of (data ?? []) as unknown as (MiembroArea & { area_id: string; profile: Profile | null })[]) {
      if (!fila.profile) continue
      const lista = porArea.get(fila.area_id) ?? []
      lista.push({ rol: fila.rol, profile: fila.profile })
      porArea.set(fila.area_id, lista)
    }
    for (const lista of porArea.values()) {
      lista.sort((a, b) => (a.profile.full_name ?? a.profile.email).localeCompare(b.profile.full_name ?? b.profile.email))
    }
    setMiembrosPorArea(porArea)
  }, [idsAreas])

  useEffect(() => {
    if (idsAreas.length === 0) {
      setLoading(false)
      return
    }
    void Promise.all([
      cargarMiembros(),
      supabase
        .from('tickets')
        .select('area_id, estado, asignado_a, es_grupal')
        .in('area_id', idsAreas)
        .then(({ data }) => {
          const porArea = new Map<string, TicketResumen[]>()
          for (const t of (data ?? []) as TicketResumen[]) {
            porArea.set(t.area_id, [...(porArea.get(t.area_id) ?? []), t])
          }
          setTicketsPorArea(porArea)
        }),
      supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('activo', true)
        .order('full_name')
        .then(({ data }) => setPerfiles(data ?? [])),
    ]).then(() => setLoading(false))
  }, [idsAreas, cargarMiembros])

  const termino = busqueda.trim().toLowerCase()
  const areasVisibles = areasLider.filter((area) => {
    if (!termino) return true
    if (area.nombre.toLowerCase().includes(termino)) return true
    return (miembrosPorArea.get(area.id) ?? []).some((m) =>
      `${m.profile.full_name ?? ''} ${m.profile.email}`.toLowerCase().includes(termino),
    )
  })

  function abrirTablero(areaId: string) {
    seleccionarArea(areaId)
    navigate('/tablero')
  }

  if (loading) return <div className="pantalla-carga">Cargando grupos...</div>

  return (
    <div className="admin-page">
      <div className="board-page__toolbar">
        <div>
          <h1>Grupos</h1>
          <p className="board-page__subtitulo">
            Cada grupo tiene su propio tablero. Solo su líder y sus agentes lo ven y lo trabajan; cualquier
            persona puede enviarle solicitudes.
          </p>
        </div>
        <div className="board-page__filtros">
          <input
            type="search"
            className="board-page__buscador"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar grupo o persona…"
            aria-label="Buscar grupo o persona"
          />
        </div>
      </div>

      <div className="grupos-grid">
        {areasVisibles.map((area) => {
          const miembros = miembrosPorArea.get(area.id) ?? []
          const resumen = resumir(ticketsPorArea.get(area.id) ?? [])
          const abierto = gestionando === area.id
          return (
            <section key={area.id} className={`grupo-card${abierto ? ' grupo-card--abierto' : ''}`}>
              <header className="grupo-card__header">
                <div>
                  <h2>{area.nombre}</h2>
                  <span className="admin-table__texto-sutil">
                    {miembros.length} {miembros.length === 1 ? 'miembro' : 'miembros'}
                    {areaActiva?.id === area.id && ' · Grupo activo'}
                  </span>
                </div>
                <div className="grupo-card__acciones">
                  <button type="button" className="admin-table__accion-secundaria" onClick={() => setGestionando(abierto ? null : area.id)} aria-expanded={abierto}>
                    {abierto ? 'Cerrar' : 'Gestionar miembros'}
                  </button>
                  <button type="button" onClick={() => abrirTablero(area.id)}>
                    Abrir tablero
                  </button>
                </div>
              </header>

              <dl className="grupo-card__tablero" aria-label={`Resumen del tablero de ${area.nombre}`}>
                <div>
                  <dt>Sin asignar</dt>
                  <dd>{resumen.sinAsignar}</dd>
                </div>
                <div className="grupo-card__estado--pendiente">
                  <dt>Pendientes</dt>
                  <dd>{resumen.pendiente}</dd>
                </div>
                <div className="grupo-card__estado--en_curso">
                  <dt>En curso</dt>
                  <dd>{resumen.enCurso}</dd>
                </div>
                <div className="grupo-card__estado--finalizado">
                  <dt>Finalizadas</dt>
                  <dd>{resumen.finalizado}</dd>
                </div>
              </dl>

              {abierto ? (
                <MiembrosArea
                  areaId={area.id}
                  areaNombre={area.nombre}
                  miembros={miembros}
                  perfiles={perfiles}
                  onCambio={cargarMiembros}
                />
              ) : (
                <div className="grupo-card__roles">
                  {ROLES_EN_ORDEN.map(({ rol, titulo }) => {
                    const deRol = miembros.filter((m) => m.rol === rol)
                    if (deRol.length === 0) return null
                    return (
                      <div key={rol}>
                        <p className="grupo-card__rol-titulo">
                          {titulo} <span>{deRol.length}</span>
                        </p>
                        <ul className="grupo-card__personas">
                          {deRol.map((m) => {
                            const nombre = m.profile.full_name ?? m.profile.email
                            return (
                              <li key={m.profile.id} title={m.profile.email} className={m.profile.activo ? undefined : 'grupo-card__persona--revocada'}>
                                <span className="grupo-card__avatar" aria-hidden="true">{iniciales(nombre)}</span>
                                {nombre}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )
                  })}
                  {miembros.length === 0 && <p className="admin-table__texto-sutil">Todavía no tiene miembros.</p>}
                </div>
              )}
            </section>
          )
        })}
        {areasVisibles.length === 0 && (
          <p className="admin-table__texto-sutil">
            {areasLider.length === 0 ? 'No lideras ningún grupo.' : 'Ningún grupo coincide con la búsqueda.'}
          </p>
        )}
      </div>
    </div>
  )
}
