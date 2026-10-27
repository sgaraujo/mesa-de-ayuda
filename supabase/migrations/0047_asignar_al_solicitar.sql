-- Asignar al enviar una solicitud: quien pide algo a otra área puede elegir
-- (opcional) a una persona de esa área en /nueva-solicitud. Sin elegir, la
-- solicitud sigue llegando sin asignar a la bandeja general.
--
-- Quien no es miembro no ve area_miembros de otras áreas (tablero cerrado),
-- así que la lista de personas sale de esta función: solo id, nombre,
-- correo y rol de los miembros activos del área destino.

create or replace function public.miembros_area_solicitud(p_area_id uuid)
returns table (id uuid, full_name text, email text, rol text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.email, am.rol
  from area_miembros am
  join profiles p on p.id = am.profile_id
  where am.area_id = p_area_id
    and p.activo
    and public.usuario_activo()
  order by p.full_name nulls last, p.email;
$$;

revoke all on function public.miembros_area_solicitud(uuid) from public, anon;
grant execute on function public.miembros_area_solicitud(uuid) to authenticated;

-- ¿La persona es miembro activo del área? Security definer por la misma
-- razón: la policy de tickets no puede leer area_miembros de otra área.
create or replace function public.es_miembro_de_area(p_profile_id uuid, p_area_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from area_miembros am
    join profiles p on p.id = am.profile_id
    where am.area_id = p_area_id and am.profile_id = p_profile_id and p.activo
  );
$$;

revoke all on function public.es_miembro_de_area(uuid, uuid) from public, anon;
grant execute on function public.es_miembro_de_area(uuid, uuid) to authenticated;

-- Antes, quien no gestiona el área solo podía crear la tarea sin asignar.
-- Ahora también puede dejarla asignada a un miembro de esa área (individual,
-- nunca en grupo).
drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets
  for insert to authenticated
  with check (
    public.usuario_activo()
    and solicitante_id = auth.uid()
    and (
      (
        not es_grupal
        and (asignado_a is null or public.es_miembro_de_area(asignado_a, area_id))
      )
      or public.puedo_gestionar_area(area_id)
    )
  );
