-- Permite desactivar cuentas sin borrar perfiles ni romper el historial.
alter table profiles add column activo boolean not null default true;

create or replace function public.usuario_activo()
returns boolean language sql stable security definer set search_path = public
as $$
  select coalesce((select activo from profiles where id = auth.uid()), false);
$$;

create or replace function public.rol_actual()
returns text language sql stable security definer set search_path = public
as $$
  select role from profiles where id = auth.uid() and activo;
$$;

drop policy areas_select on areas;
create policy areas_select on areas for select to authenticated using (public.usuario_activo());

drop policy profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated using (
  id = auth.uid() or public.usuario_activo()
);

drop policy profiles_update_propio on profiles;
create policy profiles_update_propio on profiles for update to authenticated
  using (id = auth.uid() and public.usuario_activo())
  with check (id = auth.uid() and public.usuario_activo());

drop policy tickets_select on tickets;
create policy tickets_select on tickets for select to authenticated using (
  public.usuario_activo() and (
    solicitante_id = auth.uid()
    or public.rol_actual() = 'admin'
    or (
      public.rol_actual() = 'agente'
      and (
        asignado_a = auth.uid()
        or asignado_a is null
        or exists (select 1 from ticket_asignados ta where ta.ticket_id = tickets.id and ta.profile_id = auth.uid())
      )
    )
  )
);

drop policy tickets_insert on tickets;
create policy tickets_insert on tickets for insert to authenticated with check (
  public.usuario_activo() and solicitante_id = auth.uid()
);

create or replace function public.puedo_ver_ticket(p_ticket_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.usuario_activo() and exists (
    select 1 from tickets t
    where t.id = p_ticket_id
      and (
        t.solicitante_id = auth.uid()
        or public.rol_actual() = 'admin'
        or (
          public.rol_actual() = 'agente'
          and (
            t.asignado_a = auth.uid() or t.asignado_a is null
            or exists (select 1 from ticket_asignados ta where ta.ticket_id = t.id and ta.profile_id = auth.uid())
          )
        )
      )
  );
$$;

drop policy proyectos_select on proyectos;
create policy proyectos_select on proyectos for select to authenticated using (public.usuario_activo());

drop policy ticket_imagenes_insert on storage.objects;
create policy ticket_imagenes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-imagenes' and public.usuario_activo());
