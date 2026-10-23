-- Sincronización con Nelyoda (Inteegrados), la plataforma de Talento Humano.
--
-- Nelyoda avisa en tiempo real (trigger de Firestore + barrido nocturno) a la
-- Edge Function sincronizar-nelyoda, que es la única que escribe aquí. Solo
-- llegan datos corporativos: nada personal, salarial, bancario ni de seguridad
-- social.
--
-- Con esos datos la Edge Function:
--   · habilita como solicitante a todo empleado vigente con correo corporativo
--     (allowed_emails.origen = 'nelyoda');
--   · desactiva la cuenta de quien queda retirado y la reactiva si vuelve a
--     estar vigente, solo cuando fue ella quien la desactivó
--     (desactivo_cuenta): una revocación manual de un admin se respeta.

create table if not exists personas_nelyoda (
  -- Huella (sha-256) del id del expediente en Nelyoda, que es la cédula: se
  -- usa como llave estable sin guardar el documento.
  ref text primary key,
  email citext not null unique,
  nombre text,
  telefono text,
  activo boolean not null,
  -- Relaciones laborales vigentes: [{ empresa, proyecto, area, cuentaAnalitica, cargo, jefe }]
  relaciones jsonb not null default '[]'::jsonb,
  desactivo_cuenta boolean not null default false,
  actualizado_at timestamptz not null default now()
);

alter table personas_nelyoda enable row level security;

-- Datos de directorio corporativo (cargo, área, jefe): los ve cualquier
-- usuario activo para mostrar quién pide cada tarea. Sin policies de escritura.
drop policy if exists personas_nelyoda_select on personas_nelyoda;
create policy personas_nelyoda_select on personas_nelyoda for select to authenticated
  using (public.usuario_activo());

-- ref (huella de la cédula) y desactivo_cuenta son internos: el cliente solo
-- puede leer las columnas de directorio.
revoke all on personas_nelyoda from anon, authenticated;
grant select (email, nombre, telefono, activo, relaciones, actualizado_at)
  on personas_nelyoda to authenticated;

-- De dónde salió cada correo de la whitelist. La sincronización solo borra los
-- que ella misma agregó y nadie usó todavía.
alter table allowed_emails add column if not exists origen text not null default 'manual';
alter table allowed_emails drop constraint if exists allowed_emails_origen_check;
alter table allowed_emails add constraint allowed_emails_origen_check
  check (origen in ('manual', 'nelyoda'));
