-- Ticket Board — esquema inicial
-- Dominios corporativos autorizados: inteegra.net.co, triangulum.net.co, netcol.net.co

create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- areas
-- ---------------------------------------------------------------------------
create table areas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique
);

insert into areas (nombre) values
  ('Soporte'), ('Infraestructura'), ('Desarrollo'), ('Administrativo');

-- ---------------------------------------------------------------------------
-- allowed_emails — whitelist administrada manualmente por un admin
-- ---------------------------------------------------------------------------
create table allowed_emails (
  email citext primary key,
  area_id uuid references areas(id),
  role text not null default 'solicitante' check (role in ('admin', 'agente', 'solicitante')),
  invited_at timestamptz,
  used_at timestamptz
);

-- ---------------------------------------------------------------------------
-- profiles — 1:1 con auth.users
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  full_name text,
  area_id uuid references areas(id),
  role text not null default 'solicitante' check (role in ('admin', 'agente', 'solicitante')),
  empresa text not null,
  created_at timestamptz not null default now()
);

-- Crea el perfil automáticamente cuando un usuario invitado confirma su cuenta,
-- usando el rol/área reservados en allowed_emails y el dominio del correo para la empresa.
create function public.crear_perfil_desde_whitelist()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  whitelist_row allowed_emails%rowtype;
  dominio text;
  nombre_empresa text;
begin
  select * into whitelist_row from allowed_emails where email = new.email;

  dominio := split_part(new.email, '@', 2);
  nombre_empresa := case dominio
    when 'inteegra.net.co' then 'Inteegra'
    when 'triangulum.net.co' then 'Triangulum'
    when 'netcol.net.co' then 'Netcol'
    else dominio
  end;

  insert into public.profiles (id, email, area_id, role, empresa)
  values (
    new.id,
    new.email,
    whitelist_row.area_id,
    coalesce(whitelist_row.role, 'solicitante'),
    nombre_empresa
  );

  update allowed_emails set used_at = now() where email = new.email;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.crear_perfil_desde_whitelist();

-- ---------------------------------------------------------------------------
-- tickets
-- ---------------------------------------------------------------------------
create table tickets (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descripcion text not null,
  solicitante_id uuid not null references profiles(id),
  empresa_solicitante text not null,
  asignado_a uuid references profiles(id),
  area_id uuid references areas(id),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_curso', 'finalizado')),
  prioridad text not null default 'media' check (prioridad in ('baja', 'media', 'alta', 'urgente')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalizado_at timestamptz
);

create index tickets_estado_idx on tickets(estado);
create index tickets_area_idx on tickets(area_id);
create index tickets_asignado_idx on tickets(asignado_a);
create index tickets_solicitante_idx on tickets(solicitante_id);

create function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tickets_set_updated_at
  before update on tickets
  for each row execute procedure public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- ticket_status_history
-- ---------------------------------------------------------------------------
create table ticket_status_history (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  estado text not null check (estado in ('pendiente', 'en_curso', 'finalizado')),
  changed_at timestamptz not null default now(),
  changed_by uuid references profiles(id)
);

create index ticket_status_history_ticket_idx on ticket_status_history(ticket_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table areas enable row level security;
alter table profiles enable row level security;
alter table allowed_emails enable row level security;
alter table tickets enable row level security;
alter table ticket_status_history enable row level security;

create function public.rol_actual()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create function public.area_actual()
returns uuid language sql stable security definer set search_path = public as $$
  select area_id from profiles where id = auth.uid();
$$;

-- areas: cualquier usuario autenticado puede leerlas (para selects de formularios)
create policy areas_select on areas for select to authenticated using (true);

-- profiles: todo usuario autenticado puede ver todos los perfiles (para asignar/mostrar nombres)
create policy profiles_select on profiles for select to authenticated using (true);
create policy profiles_update_propio on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- allowed_emails: solo admins gestionan la whitelist
create policy allowed_emails_admin_all on allowed_emails for all to authenticated
  using (public.rol_actual() = 'admin') with check (public.rol_actual() = 'admin');

-- tickets:
-- - solicitantes ven y crean solo los suyos
-- - agentes ven los de su área o sin área asignada; admins ven todos
create policy tickets_select on tickets for select to authenticated using (
  solicitante_id = auth.uid()
  or public.rol_actual() = 'admin'
  or (public.rol_actual() = 'agente' and (area_id = public.area_actual() or area_id is null))
);

create policy tickets_insert on tickets for insert to authenticated with check (
  solicitante_id = auth.uid()
);

-- solo agentes/admins cambian estado o asignación; el solicitante no puede editar tras crear
create policy tickets_update_agentes on tickets for update to authenticated
  using (public.rol_actual() in ('agente', 'admin'))
  with check (public.rol_actual() in ('agente', 'admin'));

-- ticket_status_history: visible a quien puede ver el ticket; solo agentes/admins insertan
create policy ticket_status_history_select on ticket_status_history for select to authenticated using (
  exists (
    select 1 from tickets t
    where t.id = ticket_id
      and (
        t.solicitante_id = auth.uid()
        or public.rol_actual() = 'admin'
        or (public.rol_actual() = 'agente' and (t.area_id = public.area_actual() or t.area_id is null))
      )
  )
);

create policy ticket_status_history_insert on ticket_status_history for insert to authenticated with check (
  public.rol_actual() in ('agente', 'admin')
);
