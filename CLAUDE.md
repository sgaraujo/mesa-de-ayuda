# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es esto

Mesa de Ayuda: app propia (no Trello) para gestionar solicitudes de trabajo del
equipo, con acceso restringido a los correos corporativos de **Inteegra**,
**Triangulum** y **Netcol** (dominios `inteegra.net.co`, `triangulum.net.co`,
`netcol.net.co` — ver `nombreEmpresa()` en [src/lib/dominio.ts](src/lib/dominio.ts)).

Stack: Vite + React 19 + TypeScript, Supabase (Postgres + Auth + RLS + Edge
Functions), desplegado en Vercel.

## Comandos

```bash
npm run dev       # servidor de desarrollo (Vite)
npm run build     # tsc -b && vite build (el build corre type-check primero)
npm run lint      # oxlint
npm run preview   # sirve el build de producción localmente
```

No hay suite de tests configurada en este proyecto.

### Supabase

```bash
supabase link --project-ref <project-ref>
supabase db push                          # aplica migraciones nuevas en supabase/migrations/
supabase functions deploy <nombre>        # despliega una Edge Function
supabase secrets set SITE_URL=...         # variables de las Edge Functions
```

Las migraciones son SQL plano, numeradas secuencialmente (`0001_...` a
`0015_...` actualmente) y nunca se editan retroactivamente — un cambio de
esquema siempre es una migración nueva.

## Arquitectura

### Flujo de acceso y roles

No hay auto-registro: un admin da de alta correos en `allowed_emails`
(`/admin/whitelist`, alta manual o CSV `correo,rol,area`). El flujo completo:

1. `/solicitar-acceso` → Edge Function `invite-user` valida el correo contra
   `allowed_emails` y el dominio permitido, genera un link de invitación con
   Supabase Auth (`generateLink`) y lo envía por **Microsoft Graph API**
   (no el SMTP de Supabase — el tenant de Microsoft 365 no permite SMTP AUTH
   básico; ver [supabase/functions/_shared/graph.ts](supabase/functions/_shared/graph.ts)).
   Siempre responde `{ ok: true }` para no filtrar por enumeración si un
   correo está en la whitelist.
2. `/crear-password` define la contraseña desde el link del correo.
2. Login normal en `/login` después de eso.

Tres roles (`src/types/database.ts`): `solicitante` (crea tickets, ve solo
los suyos), `agente` (ve/gestiona tickets asignados a su área), `admin`
(todo, incluida la whitelist). El primer admin se inserta a mano por SQL
(no hay quien lo invite desde la UI hasta que exista uno).

`AuthProvider` ([src/context/AuthContext.tsx](src/context/AuthContext.tsx))
espera a que `getSession()` resuelva antes de decidir si hay perfil — hacerlo
antes causaba un parpadeo a `/login` y de vuelta que duplicaba la carga de
chunks lazy. También cierra sesión localmente si `profiles.activo` es
`false` (usuario revocado). El control de acceso por ruta vive en
[src/components/ProtectedRoute.tsx](src/components/ProtectedRoute.tsx) vía
prop `rolesPermitidos`, ver el árbol de rutas en [src/App.tsx](src/App.tsx).

### Modelo de datos y RLS

Esquema completo en `supabase/migrations/`. Piezas clave:
- `tickets`: entidad central (estado, prioridad, asignación, tiempos,
  proyecto/área). Puede ser individual (`asignado_a`) o grupal
  (`es_grupal` + tabla `ticket_asignados`, N agentes por ticket).
- `ticket_status_history`: auditoría de cada cambio de estado (se inserta a
  mano junto con cada `update` de `tickets.estado`, no hay trigger).
- `allowed_emails`: whitelist de acceso (independiente de `profiles`).
- RLS en casi todas las tablas. **Cuidado con la recursión**: la policy de
  `tickets` consulta `ticket_asignados` y viceversa, lo cual generaba
  "infinite recursion detected in policy". Se resolvió con funciones
  `security definer` (`puedo_ver_ticket`, `rol_actual`) que evitan
  re-disparar RLS en sus propias consultas — ver
  [supabase/migrations/0007_fix_recursion_rls.sql](supabase/migrations/0007_fix_recursion_rls.sql).
  Cualquier policy nueva que cruce estas tablas debe pasar por ese mismo
  patrón en vez de referenciarlas directamente.

### Tablero (BoardPage) y realtime

[src/pages/BoardPage.tsx](src/pages/BoardPage.tsx) es la pieza más compleja
del frontend. Combina:
- `@dnd-kit` para arrastrar tickets entre columnas (`tareas` sin asignar →
  `pendiente` → `en_curso` → `finalizado`); soltar en "Tareas" desasigna,
  soltar en cualquier otra columna desde "Tareas" asigna al usuario actual.
  Los tickets grupales (`es_grupal`) solo cambian de estado al arrastrar — la
  (des)asignación de agentes se maneja desde el modal de detalle, no drag&drop.
- Un canal de Supabase Realtime combinado: `broadcast` (`tickets_changed`,
  emitido por el propio cliente tras cada mutación) + `postgres_changes` en
  `tickets` y `ticket_asignados`. Ambos alimentan la misma cola de
  `ticketId`s pendientes, debounced 400ms, para refrescar solo los tickets
  que cambiaron en vez de recargar todo el tablero en cada evento.
- Vistas distintas por rol: `solicitante` ve 2 columnas (sus propias
  solicitudes), agente/admin ven 4. `vistaHistorial` (solo admin) filtra
  tickets finalizados hace más de 30 días, que de otro modo desaparecen del
  tablero activo.

### Edge Functions (`supabase/functions/`)

Deno, cada una en su carpeta con `index.ts`. Código compartido en `_shared/`
(`graph.ts` para envío de correo vía Microsoft Graph, `email-template.ts`
para el HTML de los correos). Funciones actuales: `invite-user`,
`reset-password`, `revoke-user`, `notify-assignment`, `send-welcome-email`,
`admin-set-password`. Todas usan el service role key
(`SUPABASE_SERVICE_ROLE_KEY`, disponible automáticamente en runtime) para
saltarse RLS de forma controlada — son el único lugar donde eso es correcto.

### Estructura de `src/`

```
pages/       páginas de la app (auth, tablero, estadísticas, admin)
components/  Layout, Kanban, tarjetas, modales, gráficos
context/     AuthProvider (sesión + perfil)
hooks/       fetch de áreas, agentes, proyectos
lib/         cliente Supabase, utilidades de dominio, agregaciones para stats
types/       tipos de las tablas de Supabase (fuente de verdad: database.ts)
```

`App.tsx` carga cada página con `lazyConReintento` (wrapper sobre
`React.lazy`): si un chunk falla al pedirse (build nuevo desplegado con hashes
distintos mientras el navegador tenía la app abierta), recarga la página una
vez en vez de mostrar el error de MIME type de Vercel.

## Convenciones

- Identificadores de dominio (funciones, variables, columnas de negocio) en
  español; el código de infraestructura (tipos de React/Supabase, nombres de
  librería) en inglés. Sigue ese mismo idioma al tocar cada capa.
- `oxlint` es el único linter configurado (`react/rules-of-hooks` como
  error). No hay Prettier ni ESLint en este repo.
