# Mesa de Ayuda — Ticket Board

App propia (no Trello) para gestionar solicitudes de trabajo del equipo, con
acceso restringido a los correos corporativos de **Inteegra**, **Triangulum** y
**Netcol**.

## Stack

- Vite + React + TypeScript
- Supabase (Postgres + Auth + Row Level Security + Edge Functions)
- Despliegue en Vercel

## Flujo de acceso

1. Un admin carga los correos autorizados en `/admin/whitelist` (alta manual o
   CSV `correo,rol,area`).
2. La persona entra a `/solicitar-acceso` e ingresa su correo. La Edge Function
   `invite-user` valida que esté en la whitelist y en uno de los 3 dominios
   permitidos, y le envía un correo de invitación de Supabase Auth.
3. Desde el link del correo, la persona define su contraseña en
   `/crear-password`.
4. Login normal después en `/login`.

## Setup local

1. Crear un proyecto en [supabase.com](https://supabase.com).
2. Copiar `.env.example` a `.env` y completar `VITE_SUPABASE_URL` y
   `VITE_SUPABASE_ANON_KEY` (Project Settings → API).
3. Instalar dependencias y correr:

   ```bash
   npm install
   npm run dev
   ```

4. Aplicar las migraciones (con [Supabase CLI](https://supabase.com/docs/guides/cli)):

   ```bash
   supabase link --project-ref <tu-project-ref>
   supabase db push
   ```

5. Desplegar la Edge Function de invitación y configurar sus variables:

   ```bash
   supabase functions deploy invite-user
   supabase secrets set SITE_URL=https://tu-dominio.vercel.app
   ```

   `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya están disponibles
   automáticamente dentro de las Edge Functions.

6. Crear el primer admin manualmente: insertar su correo en `allowed_emails`
   con `role = 'admin'` directamente desde el SQL editor de Supabase (antes de
   que exista un admin no hay quien lo invite desde la UI):

   ```sql
   insert into allowed_emails (email, role) values ('tu-correo@netcol.net.co', 'admin');
   ```

   Luego pasa por `/solicitar-acceso` con ese correo para crear tu contraseña.

## Despliegue en Vercel

Conectar este repo en Vercel y definir las mismas variables de entorno
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) en la configuración del
proyecto. Build command: `npm run build`, output: `dist`.

## Estructura

```
src/
  pages/       páginas de la app (auth, tablero, estadísticas, admin)
  components/  Layout, Kanban, tarjetas, gráficos
  context/     AuthProvider (sesión + perfil)
  hooks/       fetch de áreas y agentes
  lib/         cliente Supabase, utilidades de dominio y agregación
supabase/
  migrations/  esquema SQL (tablas, RLS, triggers)
  functions/   Edge Function de invitación
```
