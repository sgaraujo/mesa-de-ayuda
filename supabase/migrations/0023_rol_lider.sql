-- Rol "líder": quien dirige un área. Antes el rol de área se llamaba 'admin',
-- igual que el superadmin de la whitelist (profiles.role = 'admin', que ve
-- todos los tableros), y era fácil dar acceso total por error al querer
-- nombrar al jefe de un área. Ahora:
--
--   profiles.role / allowed_emails.role
--     admin        superadmin: ve y gestiona todas las áreas y la whitelist
--     lider        líder del área indicada en la whitelist
--     agente       agente del área indicada en la whitelist
--     solicitante  no entra a ningún tablero; solo envía y sigue solicitudes
--
--   area_miembros.rol
--     lider        ve todo el tablero de su área y gestiona sus miembros
--     agente       ve lo suyo y la bandeja general de su área
--
-- Un líder nunca ve tareas, proyectos ni miembros de otras áreas.
-- 'solicitante' deja de ser rol de área: cualquiera puede pedirle a cualquier
-- área sin ser miembro (ver tickets_insert en 0022).

-- ---------------------------------------------------------------------------
-- area_miembros: admin → lider, sin solicitantes
-- ---------------------------------------------------------------------------
alter table area_miembros drop constraint if exists area_miembros_rol_check;
update area_miembros set rol = 'lider' where rol = 'admin';
delete from area_miembros where rol = 'solicitante';
alter table area_miembros add constraint area_miembros_rol_check check (rol in ('lider', 'agente'));

-- ---------------------------------------------------------------------------
-- profiles y allowed_emails aceptan 'lider'
-- ---------------------------------------------------------------------------
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin', 'lider', 'agente', 'solicitante'));

alter table allowed_emails drop constraint if exists allowed_emails_role_check;
alter table allowed_emails add constraint allowed_emails_role_check
  check (role in ('admin', 'lider', 'agente', 'solicitante'));

-- ---------------------------------------------------------------------------
-- Funciones y policies que miraban el rol de área 'admin'
-- ---------------------------------------------------------------------------
create or replace function public.puedo_gestionar_area(p_area_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.es_superadmin() or coalesce(public.rol_en_area(p_area_id) in ('lider', 'agente'), false);
$$;

create or replace function public.puedo_ver_ticket(p_ticket_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.usuario_activo() and exists (
    select 1 from tickets t
    where t.id = p_ticket_id
      and (
        public.es_superadmin()
        or t.solicitante_id = auth.uid()
        or public.rol_en_area(t.area_id) = 'lider'
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

drop policy tickets_select on tickets;
create policy tickets_select on tickets for select to authenticated using (
  public.usuario_activo() and (
    public.es_superadmin()
    or solicitante_id = auth.uid()
    or public.rol_en_area(area_id) = 'lider'
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

drop policy tickets_delete_admin on tickets;
create policy tickets_delete_lider on tickets for delete to authenticated
  using (public.es_superadmin() or public.rol_en_area(area_id) = 'lider');

drop policy area_miembros_write on area_miembros;
create policy area_miembros_write on area_miembros for all to authenticated
  using (public.es_superadmin() or public.rol_en_area(area_id) = 'lider')
  with check (public.es_superadmin() or public.rol_en_area(area_id) = 'lider');

-- ---------------------------------------------------------------------------
-- Whitelist → membresía: solo líderes y agentes entran al tablero del área
-- indicada. El superadmin no necesita membresía (ve todo) y el solicitante
-- no entra a ninguno.
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

    if new.area_id is not null and new.role in ('lider', 'agente') then
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

  if whitelist_row.area_id is not null and whitelist_row.role in ('lider', 'agente') then
    insert into public.area_miembros (area_id, profile_id, rol)
    values (whitelist_row.area_id, new.id, whitelist_row.role)
    on conflict do nothing;
  end if;

  update public.allowed_emails
  set used_at = now()
  where lower(trim(email)) = correo_normalizado;

  return new;
end;
$$;
