// Anuncios de "Novedades" que la app muestra una vez a cada persona después
// de un despliegue (NovedadesModal en el Layout). Para anunciar algo nuevo,
// agrega una entrada AL PRINCIPIO de NOVEDADES con un id nuevo (la fecha del
// despliegue, y un sufijo si hay dos el mismo día). Quien ya vio la anterior
// verá solo las nuevas; quien creó su cuenta después de la fecha no las ve.

// A quién le aplica cada punto: 'equipo' = líderes y agentes de algún área.
export type AudienciaNovedad = 'todos' | 'equipo' | 'lideres'

export interface PuntoNovedad {
  titulo: string
  texto: string
  audiencia?: AudienciaNovedad
}

export interface Novedad {
  id: string
  /** Día del anuncio (AAAA-MM-DD), hora de Colombia. */
  fecha: string
  titulo: string
  puntos: PuntoNovedad[]
}

export const NOVEDADES: Novedad[] = [
  {
    id: '2026-11-17-estadisticas',
    fecha: '2026-11-17',
    titulo: 'Estadísticas con el trabajo real del periodo',
    puntos: [
      {
        titulo: 'Creadas, actualizadas y finalizadas por separado',
        texto:
          'Una tarea creada la semana pasada y cerrada esta semana ahora cuenta como finalizada (y actualizada) esta semana. También verás el balance entre lo que entra y lo que se cierra.',
        audiencia: 'equipo',
      },
      {
        titulo: 'Horas del periodo',
        texto:
          'Las horas cuentan el día en que se registraron, por persona, proyecto y área, con la tendencia semanal del trabajo real.',
        audiencia: 'equipo',
      },
    ],
  },
  {
    id: '2026-11-17',
    fecha: '2026-11-17',
    titulo: 'Lo nuevo en la Mesa de Ayuda',
    puntos: [
      {
        titulo: 'Tú decides si te llegan correos',
        texto:
          'En Configuración (el engranaje junto a tu nombre) puedes apagar los correos de asignaciones, menciones, finalizaciones y vencimientos. La campanita te sigue avisando de todo.',
      },
      {
        titulo: 'Solicitudes a Operación con su proyecto',
        texto:
          'Las solicitudes de NOC - ETB y Operación SOMOS ahora se envían al área Operación, indicando el proyecto al que pertenecen.',
      },
      {
        titulo: 'Repetición semanal',
        texto:
          'Una tarea ahora puede repetirse cada semana, en uno o varios días (de lunes a domingo).',
        audiencia: 'equipo',
      },
      {
        titulo: 'Eliminar tareas con aviso',
        texto:
          'Si eliminas una tarea en la que hay otras personas, te pedimos el motivo y les avisamos por la campanita y por correo.',
        audiencia: 'lideres',
      },
    ],
  },
]

export interface ContextoNovedades {
  esLider: boolean
  esEquipo: boolean
}

export function puntoAplica(punto: PuntoNovedad, { esLider, esEquipo }: ContextoNovedades): boolean {
  if (punto.audiencia === 'lideres') return esLider
  if (punto.audiencia === 'equipo') return esEquipo
  return true
}

/** Novedades con al menos un punto para esta persona, solo con esos puntos. */
export function novedadesPara(contexto: ContextoNovedades): Novedad[] {
  return NOVEDADES
    .map((n) => ({ ...n, puntos: n.puntos.filter((p) => puntoAplica(p, contexto)) }))
    .filter((n) => n.puntos.length > 0)
}

/**
 * Las que todavía no ha visto: las publicadas después de `vista` (o todas si
 * nunca vio ninguna), sin contar las anteriores a la creación de su cuenta.
 */
export function novedadesPendientes(
  contexto: ContextoNovedades,
  vista: string | null | undefined,
  cuentaCreada: string,
): Novedad[] {
  const lista = novedadesPara(contexto)
  const corte = vista ? NOVEDADES.findIndex((n) => n.id === vista) : -1
  const desdeCuenta = cuentaCreada.slice(0, 10)
  return lista.filter((n) => {
    const indice = NOVEDADES.findIndex((x) => x.id === n.id)
    return (corte === -1 || indice < corte) && n.fecha >= desdeCuenta
  })
}
