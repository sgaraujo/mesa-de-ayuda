-- Cada área tiene su propio tablero cerrado. El rol ya no es uno solo por
-- persona: se define por área en area_miembros, y una persona puede estar en
-- varias áreas con roles distintos (admin, agente o solicitante). Cualquiera
-- puede enviarle solicitudes a cualquier área, pero solo los miembros ven y
-- trabajan su tablero.
--
-- profiles.role queda solo para distinguir al superadmin global
-- (role = 'admin'): crea áreas, gestiona la whitelist y ve todos los tableros.
-- Para cualquier otro permiso cuenta el rol en el área del ticket.
--
-- Todas las funciones nuevas son security definer, igual que puedo_ver_ticket
-- (ver 0007): area_miembros se consulta desde las policies de tickets y de sí
-- misma, y así no se vuelve a disparar RLS dentro de ellas.

-- ---------------------------------------------------------------------------
-- area_miembros
-- ---------------------------------------------------------------------------
create table area_miembros (
  area_id uuid not null references areas(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  rol text not null check (rol in ('admin', 'agente', 'solicitante')),
  created_at timestamptz not null default now(),
  primary key (area_id, profile_id)
);

create index area_miembros_profile_idx on area_miembros(profile_id);

alter table area_miembros enable row level security;

-- ---------------------------------------------------------------------------
-- Datos existentes: todo lo que había hasta ahora era trabajo del equipo de
-- desarrollo. Se crea su área y quedan en ella todas las tareas, todos los
-- proyectos y todos los agentes y admins actuales (con su mismo rol). Las
-- demás áreas arrancan con su tablero vacío y no ven nada de esto. Los
-- solicitantes no entran a ningún tablero: siguen sus solicitudes en
-- /mis-solicitudes (tickets_select por solicitante_id).
-- ---------------------------------------------------------------------------
insert into areas (nombre, orden)
values ('Desarrollo', (select coalesce(max(orden), 0) + 1 from areas))
on conflict (nombre) do nothing;

insert into area_miembros (area_id, profile_id, rol)
select (select id from areas where nombre = 'Desarrollo'), p.id, p.role
from profiles p
where p.role in ('admin', 'agente')
on conflict do nothing;

-- Se apaga el trigger de updated_at para no alterar la fecha de modificación.
alter table tickets disable trigger tickets_set_updated_at;
update tickets set area_id = (select id from areas where nombre = 'Desarrollo');
alter table tickets enable trigger tickets_set_updated_at;

-- Todo ticket pertenece a un tablero.
alter table tickets alter column area_id set not null;

-- ---------------------------------------------------------------------------
-- Funciones de permisos
-- ---------------------------------------------------------------------------
create function public.es_superadmin()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce(public.rol_actual() = 'admin', false);
$$;

create function public.rol_en_area(p_area_id uuid)
returns text language sql stable security definer set search_path = public
as $$
  select am.rol
  from area_miembros am
  where am.area_id = p_area_id and am.profile_id = auth.uid() and public.usuario_activo();
$$;

-- Admin y agentes de un área gestionan sus tickets (estado, asignación,
-- tiempos). El superadmin gestiona todos.
create function public.puedo_gestionar_area(p_area_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.es_superadmin() or coalesce(public.rol_en_area(p_area_id) in ('admin', 'agente'), false);
$$;

create function public.puedo_gestionar_ticket(p_ticket_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from tickets t
    where t.id = p_ticket_id and public.puedo_gestionar_area(t.area_id)
  );
$$;

-- Dentro de un área se conserva la visibilidad de antes (0005): el admin del
-- área ve todo el tablero, cada agente ve lo suyo más la bandeja general y
-- el solicitante solo lo que él pidió.
create or replace function public.puedo_ver_ticket(p_ticket_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.usuario_activo() and exists (
    select 1 from tickets t
    where t.id = p_ticket_id
      and (
        public.es_superadmin()
        or t.solicitante_id = auth.uid()
        or public.rol_en_area(t.area_id) = 'admin'
        or (
          public.rol_en_area(t.area_id) = 'agente'
          and (
            t.asignado_a = auth.uid() or t.asignado_a is null
            or exists (select 1 from ticket_asignados ta where ta.ticket_id = t.id and ta.profile_id = auth.uid())
          )
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Policies de area_miembros
-- ---------------------------------------------------------------------------
-- Los miembros de un área se ven entre sí (para asignar tareas y armar grupos).
create policy area_miembros_select on area_miembros for select to authenticated using (
  public.usuario_activo() and (
    profile_id = auth.uid()
    or public.es_superadmin()
    or public.rol_en_area(area_id) is not null
  )
);

-- Solo el admin del área (o el superadmin) agrega, cambia o quita miembros.
create policy area_miembros_write on area_miembros for all to authenticated
  using (public.es_superadmin() or public.rol_en_area(area_id) = 'admin')
  with check (public.es_superadmin() or public.rol_en_area(area_id) = 'admin');

-- ---------------------------------------------------------------------------
-- tickets
-- ---------------------------------------------------------------------------
drop policy tickets_select on tickets;
create policy tickets_select on tickets for select to authenticated using (
  public.usuario_activo() and (
    public.es_superadmin()
    or solicitante_id = auth.uid()
    or public.rol_en_area(area_id) = 'admin'
    or (
      public.rol_en_area(area_id) = 'agente'
      and (
        asignado_a = auth.uid()
        or asignado_a is null
        or exists (select 1 from ticket_asignados ta where ta.ticket_id = tickets.id and ta.profile_id = auth.uid())
      )
    )
  )
);

-- Solicitudes entre áreas: cualquier persona activa puede enviarle una
-- solicitud a cualquier área (queda en la bandeja general de ese tablero) y
-- la sigue por tickets_select (solicitante_id = auth.uid()), sin ver nada más
-- del tablero. Solo quien gestiona el área puede crearla ya asignada.
drop policy tickets_insert on tickets;
create policy tickets_insert on tickets for insert to authenticated with check (
  public.usuario_activo()
  and solicitante_id = auth.uid()
  and ((asignado_a is null and not es_grupal) or public.puedo_gestionar_area(area_id))
);

drop policy tickets_update_agentes on tickets;
create policy tickets_update_gestores on tickets for update to authenticated
  using (public.puedo_gestionar_area(area_id))
  with check (public.puedo_gestionar_area(area_id));

drop policy tickets_delete_admin on tickets;
create policy tickets_delete_admin on tickets for delete to authenticated
  using (public.es_superadmin() or public.rol_en_area(area_id) = 'admin');

-- ---------------------------------------------------------------------------
-- ticket_status_history y ticket_asignados
-- ---------------------------------------------------------------------------
drop policy ticket_status_history_select on ticket_status_history;
create policy ticket_status_history_select on ticket_status_history for select to authenticated using (
  public.puedo_ver_ticket(ticket_id)
);

drop policy ticket_status_history_insert on ticket_status_history;
create policy ticket_status_history_insert on ticket_status_history for insert to authenticated with check (
  public.puedo_gestionar_ticket(ticket_id)
);

drop policy ticket_asignados_write on ticket_asignados;
create policy ticket_asignados_write on ticket_asignados for all to authenticated
  using (public.puedo_gestionar_ticket(ticket_id))
  with check (public.puedo_gestionar_ticket(ticket_id));

-- ---------------------------------------------------------------------------
-- proyectos: cada área tiene los suyos y las demás no los ven. Los que
-- existían son todos del equipo de desarrollo.
-- ---------------------------------------------------------------------------
alter table proyectos add column area_id uuid references areas(id) on delete cascade;
update proyectos set area_id = (select id from areas where nombre = 'Desarrollo');
alter table proyectos alter column area_id set not null;
alter table proyectos drop constraint if exists proyectos_nombre_key;
alter table proyectos add constraint proyectos_area_nombre_key unique (area_id, nombre);

drop policy proyectos_select on proyectos;
-- Quien envió una solicitud a otra área ve el proyecto que le asignaron.
create policy proyectos_select on proyectos for select to authenticated using (
  public.usuario_activo() and (
    public.es_superadmin() or public.rol_en_area(area_id) is not null
    or exists (select 1 from tickets t where t.proyecto_id = proyectos.id and t.solicitante_id = auth.uid())
  )
);

drop policy proyectos_agentes_admin_write on proyectos;
create policy proyectos_gestores_write on proyectos for all to authenticated
  using (public.puedo_gestionar_area(area_id))
  with check (public.puedo_gestionar_area(area_id));

-- ---------------------------------------------------------------------------
-- Whitelist: el área y rol con que se invita a alguien crean su primera
-- membresía. Las demás se gestionan desde la página de miembros del área.
-- ---------------------------------------------------------------------------
create or replace function public.sincronizar_whitelist_con_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  perfil_id uuid;
begin
  new.email := lower(trim(new.email));

  select id into perfil_id
  from public.profiles
  where lower(trim(email)) = new.email
  limit 1;

  if perfil_id is not null then
    update public.profiles
    set role = new.role,
        area_id = new.area_id
    where id = perfil_id;

    if new.area_id is not null then
      insert into public.area_miembros (area_id, profile_id, rol)
      values (new.area_id, perfil_id, new.role)
      on conflict (area_id, profile_id) do update set rol = excluded.rol;
    end if;

    new.used_at := coalesce(new.used_at, now());
  end if;

  return new;
end;
$$;

create or replace function public.crear_perfil_desde_whitelist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  whitelist_row public.allowed_emails%rowtype;
  correo_normalizado text;
  dominio text;
  nombre_empresa text;
begin
  correo_normalizado := lower(trim(new.email));

  select * into whitelist_row
  from public.allowed_emails
  where lower(trim(email)) = correo_normalizado
  limit 1;

  dominio := split_part(correo_normalizado, '@', 2);
  nombre_empresa := case dominio
    when 'inteegra.net.co' then 'Inteegra'
    when 'triangulum.net.co' then 'Triangulum'
    when 'netcol.net.co' then 'Netcol'
    else dominio
  end;

  insert into public.profiles (id, email, area_id, role, empresa)
  values (
    new.id,
    correo_normalizado,
    whitelist_row.area_id,
    coalesce(whitelist_row.role, 'solicitante'),
    nombre_empresa
  );

  if whitelist_row.area_id is not null then
    insert into public.area_miembros (area_id, profile_id, rol)
    values (whitelist_row.area_id, new.id, coalesce(whitelist_row.role, 'solicitante'))
    on conflict do nothing;
  end if;

  update public.allowed_emails
  set used_at = now()
  where lower(trim(email)) = correo_normalizado;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seguridad: profiles_update_propio permitía que cualquier usuario se
-- cambiara su propio role (por ejemplo a 'admin') o su estado activo desde
-- la API. Solo el superadmin, o el service role de las Edge Functions
-- (auth.uid() nulo), puede cambiar esas columnas.
-- ---------------------------------------------------------------------------
create function public.proteger_columnas_perfil()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.activo is distinct from old.activo)
     and auth.uid() is not null
     and not public.es_superadmin() then
    raise exception 'Solo un administrador puede cambiar el rol o el estado de una cuenta'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_proteger_columnas
  before update on profiles
  for each row execute procedure public.proteger_columnas_perfil();
