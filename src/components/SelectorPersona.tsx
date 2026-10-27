import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { normalizar } from '../lib/ticket'
import { Avatar } from './Avatar'

export interface PersonaOpcion {
  id: string
  full_name: string | null
  email: string
  area_id?: string | null
  // Texto corto a la derecha (p. ej. "Líder").
  detalle?: string
}

// Opciones que no son personas ("Todas las personas", "Sin asignar"): van
// arriba, fuera de los grupos por área.
export interface OpcionFija {
  valor: string
  etiqueta: string
}

const SIN_AREA = 'Sin área'
const SEPARACION_PX = 4
const ALTO_MAX_PX = 300

// Los nombres de las áreas se piden una sola vez para todos los selectores.
let nombresAreasPromesa: Promise<Map<string, string>> | null = null

function cargarNombresAreas(): Promise<Map<string, string>> {
  nombresAreasPromesa ??= Promise.resolve(supabase.from('areas').select('id, nombre')).then(({ data }) => {
    if (!data) nombresAreasPromesa = null
    return new Map((data ?? []).map((a: { id: string; nombre: string }) => [a.id, a.nombre]))
  })
  return nombresAreasPromesa
}

export function useNombresAreas() {
  const [nombres, setNombres] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    let cancelado = false
    void cargarNombresAreas().then((mapa) => {
      if (!cancelado) setNombres(mapa)
    })
    return () => {
      cancelado = true
    }
  }, [])
  return nombres
}

function nombrePersona(p: PersonaOpcion): string {
  return p.full_name?.trim() || p.email
}

type Item =
  | { tipo: 'fija'; valor: string; etiqueta: string }
  | { tipo: 'persona'; valor: string; persona: PersonaOpcion; etiqueta: string }

interface Grupo {
  titulo: string | null
  items: Item[]
}

// Filtra por nombre o correo (sin tildes ni mayúsculas) y agrupa por área.
function useGrupos(personas: PersonaOpcion[], opcionesFijas: OpcionFija[], texto: string, etiquetaPersona?: (p: PersonaOpcion) => string) {
  const nombresAreas = useNombresAreas()
  return useMemo(() => {
    const termino = normalizar(texto.trim())
    const coincide = (t: string) => !termino || normalizar(t).includes(termino)

    const grupos: Grupo[] = []
    const fijas = opcionesFijas.filter((o) => coincide(o.etiqueta))
    if (fijas.length > 0) grupos.push({ titulo: null, items: fijas.map((o) => ({ tipo: 'fija', ...o })) })

    const porArea = new Map<string, Item[]>()
    for (const p of personas) {
      const etiqueta = etiquetaPersona?.(p) ?? nombrePersona(p)
      if (!coincide(etiqueta) && !coincide(nombrePersona(p)) && !coincide(p.email)) continue
      const area = (p.area_id && nombresAreas.get(p.area_id)) || SIN_AREA
      const lista = porArea.get(area) ?? []
      lista.push({ tipo: 'persona', valor: p.id, persona: p, etiqueta })
      porArea.set(area, lista)
    }
    const areas = [...porArea.keys()].sort((a, b) => {
      if (a === SIN_AREA) return 1
      if (b === SIN_AREA) return -1
      return a.localeCompare(b, 'es')
    })
    for (const area of areas) {
      const items = porArea.get(area)!.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'))
      grupos.push({ titulo: area, items })
    }
    return grupos
  }, [personas, opcionesFijas, texto, etiquetaPersona, nombresAreas])
}

// Lista desplegable en un portal con posición fija: así no la recortan los
// modales con scroll ni las filas compactas (subtareas).
function useLista(abierto: boolean, anclaRef: RefObject<HTMLElement | null>) {
  const [estilo, setEstilo] = useState<CSSProperties>({})

  useLayoutEffect(() => {
    if (!abierto) return
    function ubicar() {
      const ancla = anclaRef.current
      if (!ancla) return
      const r = ancla.getBoundingClientRect()
      const abajo = window.innerHeight - r.bottom
      const arriba = r.top
      const haciaArriba = abajo < Math.min(ALTO_MAX_PX, 200) && arriba > abajo
      const alto = Math.min(ALTO_MAX_PX, (haciaArriba ? arriba : abajo) - SEPARACION_PX * 3)
      const ancho = Math.max(r.width, 240)
      setEstilo({
        position: 'fixed',
        left: Math.min(r.left, window.innerWidth - ancho - 8),
        width: ancho,
        maxHeight: Math.max(alto, 120),
        ...(haciaArriba
          ? { bottom: window.innerHeight - r.top + SEPARACION_PX }
          : { top: r.bottom + SEPARACION_PX }),
      })
    }
    ubicar()
    window.addEventListener('resize', ubicar)
    window.addEventListener('scroll', ubicar, true)
    return () => {
      window.removeEventListener('resize', ubicar)
      window.removeEventListener('scroll', ubicar, true)
    }
  }, [abierto, anclaRef])

  return estilo
}

interface ListaProps {
  id: string
  grupos: Grupo[]
  activo: number
  seleccionados: Set<string>
  multiple: boolean
  estilo: CSSProperties
  onElegir: (item: Item) => void
  onActivar: (indice: number) => void
}

function Lista({ id, grupos, activo, seleccionados, multiple, estilo, onElegir, onActivar }: ListaProps) {
  const listaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listaRef.current?.querySelector('[data-activo="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activo])

  let indice = -1
  return createPortal(
    <div
      ref={listaRef}
      id={id}
      className="selector-persona__lista"
      role="listbox"
      aria-multiselectable={multiple || undefined}
      style={estilo}
      // mousedown sin propagar: el input no pierde el foco y el clic no llega
      // al fondo del modal (los eventos de React suben aunque sea un portal).
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {grupos.length === 0 && <p className="selector-persona__vacio">Nadie coincide con la búsqueda</p>}
      {grupos.map((grupo) => (
        <div key={grupo.titulo ?? '__fijas'} role="group" aria-label={grupo.titulo ?? undefined}>
          {grupo.titulo && <div className="selector-persona__grupo">{grupo.titulo}</div>}
          {grupo.items.map((item) => {
            indice += 1
            const i = indice
            const seleccionado = seleccionados.has(item.valor)
            return (
              <div
                key={item.valor}
                role="option"
                aria-selected={seleccionado}
                data-activo={i === activo}
                className={[
                  'selector-persona__opcion',
                  i === activo && 'selector-persona__opcion--activa',
                  seleccionado && 'selector-persona__opcion--seleccionada',
                  item.tipo === 'fija' && 'selector-persona__opcion--fija',
                ].filter(Boolean).join(' ')}
                onMouseEnter={() => onActivar(i)}
                onClick={() => onElegir(item)}
              >
                {item.tipo === 'persona' && <Avatar nombre={nombrePersona(item.persona)} tamano="sm" />}
                <span className="selector-persona__nombre">{item.etiqueta}</span>
                {item.tipo === 'persona' && (
                  <span className="selector-persona__detalle">{item.persona.detalle ?? item.persona.email}</span>
                )}
                {seleccionado && (
                  <svg className="selector-persona__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>,
    document.body,
  )
}

let contadorIds = 0
function useIdLista() {
  const ref = useRef<string | null>(null)
  ref.current ??= `selector-persona-${++contadorIds}`
  return ref.current
}

// Navegación con teclado común a las dos variantes.
function manejarTeclas(
  e: KeyboardEvent<HTMLInputElement>,
  abierto: boolean,
  total: number,
  setAbierto: (v: boolean) => void,
  setActivo: (f: (i: number) => number) => void,
  elegirActivo: () => void,
): boolean {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!abierto) {
      setAbierto(true)
      return true
    }
    if (total === 0) return true
    const paso = e.key === 'ArrowDown' ? 1 : -1
    setActivo((i) => (i + paso + total) % total)
    return true
  }
  if (e.key === 'Enter' && abierto) {
    e.preventDefault()
    elegirActivo()
    return true
  }
  if (e.key === 'Escape' && abierto) {
    // Cierra solo la lista, no el modal donde esté el selector.
    e.preventDefault()
    e.stopPropagation()
    setAbierto(false)
    return true
  }
  return false
}

interface SelectorPersonaProps {
  personas: PersonaOpcion[]
  valor: string
  onCambiar: (valor: string) => void
  opcionesFijas?: OpcionFija[]
  // Cómo se muestra cada persona (p. ej. "A mí" para quien usa la app).
  etiquetaPersona?: (p: PersonaOpcion) => string
  placeholder?: string
  className?: string
  id?: string
  autoFocus?: boolean
  disabled?: boolean
  'aria-label'?: string
}

// Reemplazo de <select> para elegir una persona: se escribe el nombre o el
// correo para filtrar y la lista se divide por área.
export function SelectorPersona({
  personas,
  valor,
  onCambiar,
  opcionesFijas = [],
  etiquetaPersona,
  placeholder = 'Escribe un nombre…',
  className,
  id,
  autoFocus,
  disabled,
  'aria-label': ariaLabel,
}: SelectorPersonaProps) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [activo, setActivo] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const idLista = useIdLista()

  const grupos = useGrupos(personas, opcionesFijas, abierto ? texto : '', etiquetaPersona)
  const items = useMemo(() => grupos.flatMap((g) => g.items), [grupos])
  const estilo = useLista(abierto, inputRef)

  const elegida = personas.find((p) => p.id === valor)
  const etiquetaActual = elegida
    ? etiquetaPersona?.(elegida) ?? nombrePersona(elegida)
    : opcionesFijas.find((o) => o.valor === valor)?.etiqueta ?? ''

  function abrir() {
    setTexto('')
    setAbierto(true)
    const i = items.findIndex((item) => item.valor === valor)
    setActivo(Math.max(i, 0))
  }

  function elegir(item: Item) {
    onCambiar(item.valor)
    setAbierto(false)
    inputRef.current?.blur()
  }

  return (
    <div className={`selector-persona${className ? ` ${className}` : ''}`}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={abierto}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        className="selector-persona__input"
        value={abierto ? texto : etiquetaActual}
        placeholder={abierto ? etiquetaActual || placeholder : placeholder}
        onFocus={abrir}
        onClick={() => !abierto && abrir()}
        onBlur={() => setAbierto(false)}
        onChange={(e) => {
          setTexto(e.target.value)
          setAbierto(true)
          setActivo(0)
        }}
        onKeyDown={(e) =>
          manejarTeclas(e, abierto, items.length, setAbierto, setActivo, () => {
            if (items[activo]) elegir(items[activo])
          })
        }
      />
      <svg className="selector-persona__flecha" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
      {abierto && (
        <Lista
          id={idLista}
          grupos={grupos}
          activo={activo}
          seleccionados={new Set([valor])}
          multiple={false}
          estilo={estilo}
          onElegir={elegir}
          onActivar={setActivo}
        />
      )}
    </div>
  )
}

interface SelectorPersonasProps {
  personas: PersonaOpcion[]
  valores: string[]
  onCambiar: (valores: string[]) => void
  placeholder?: string
  'aria-label'?: string
}

// Variante para elegir varias personas (equipo de una tarea en grupo): las
// elegidas quedan como chips y la lista sigue abierta al marcar.
export function SelectorPersonas({
  personas,
  valores,
  onCambiar,
  placeholder = 'Agregar persona…',
  'aria-label': ariaLabel,
}: SelectorPersonasProps) {
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const [activo, setActivo] = useState(0)
  const cajaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const idLista = useIdLista()

  const grupos = useGrupos(personas, [], texto)
  const items = useMemo(() => grupos.flatMap((g) => g.items), [grupos])
  const estilo = useLista(abierto, cajaRef)
  const seleccionados = useMemo(() => new Set(valores), [valores])
  const elegidas = valores
    .map((v) => personas.find((p) => p.id === v))
    .filter((p): p is PersonaOpcion => !!p)

  function alternar(valor: string) {
    onCambiar(seleccionados.has(valor) ? valores.filter((v) => v !== valor) : [...valores, valor])
  }

  return (
    <div
      ref={cajaRef}
      className="selector-persona selector-persona--multiple"
      onMouseDown={(e) => {
        if (e.target !== inputRef.current) {
          e.preventDefault()
          inputRef.current?.focus()
        }
      }}
    >
      {elegidas.map((p) => (
        <span key={p.id} className="selector-persona__chip">
          {nombrePersona(p)}
          <button
            type="button"
            aria-label={`Quitar a ${nombrePersona(p)}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => alternar(p.id)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={abierto}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        className="selector-persona__input"
        value={texto}
        placeholder={elegidas.length === 0 ? placeholder : ''}
        onFocus={() => setAbierto(true)}
        onBlur={() => {
          setAbierto(false)
          setTexto('')
        }}
        onChange={(e) => {
          setTexto(e.target.value)
          setAbierto(true)
          setActivo(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Backspace' && !texto && valores.length > 0) {
            onCambiar(valores.slice(0, -1))
            return
          }
          manejarTeclas(e, abierto, items.length, setAbierto, setActivo, () => {
            if (items[activo]) {
              alternar(items[activo].valor)
              setTexto('')
            }
          })
        }}
      />
      {abierto && (
        <Lista
          id={idLista}
          grupos={grupos}
          activo={activo}
          seleccionados={seleccionados}
          multiple
          estilo={estilo}
          onElegir={(item) => {
            alternar(item.valor)
            setTexto('')
          }}
          onActivar={setActivo}
        />
      )}
    </div>
  )
}
