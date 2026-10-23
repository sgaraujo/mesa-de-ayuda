-- Cambiar una tarea de área ya no es exclusivo del superadmin (0030): también
-- pueden hacerlo los líderes y agentes del área de Desarrollo. Los de las
-- demás áreas siguen sin poder.
--
-- El permiso va en una marca del área (no en su nombre) para que sobreviva a
-- un cambio de nombre y se pueda dar a otra área si hace falta:
--   update areas set reasigna_areas = true where nombre = '...';

alter table areas add column if not exists reasigna_areas boolean not null default false;

update areas set reasigna_areas = true where nombre = 'Desarrollo';

create or replace function public.puedo_cambiar_area()
returns boolean language sql stable security definer set search_path = public
as $$
  select public.usuario_activo() and (
    public.es_superadmin()
    or exists (
      select 1
      from area_miembros am
      join areas a on a.id = am.area_id
      where am.profile_id = auth.uid()
        and am.rol in ('lider', 'agente')
        and a.reasigna_areas
    )
  );
$$;

revoke all on function public.puedo_cambiar_area() from public, anon;
grant execute on function public.puedo_cambiar_area() to authenticated;

create or replace function public.proteger_area_ticket()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.area_id is distinct from old.area_id
     and auth.uid() is not null
     and not public.puedo_cambiar_area() then
    raise exception 'Solo el equipo de Desarrollo puede cambiar el área de una tarea' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Igual que en 0031, con el permiso nuevo. Fuera del superadmin, solo sobre
-- tareas que la persona puede ver.
create or replace function public.cambiar_area_ticket(p_ticket_id uuid, p_area_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  t tickets%rowtype;
begin
  if not public.puedo_cambiar_area() or not public.puedo_ver_ticket(p_ticket_id) then
    raise exception 'Solo el equipo de Desarrollo puede cambiar el área de una tarea' using errcode = '42501';
  end if;

  select * into t from tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'La tarea no existe' using errcode = 'P0002';
  end if;
  if not exists (select 1 from areas where id = p_area_id) then
    raise exception 'El área no existe' using errcode = 'P0002';
  end if;
  if t.area_id = p_area_id then
    return;
  end if;

  delete from ticket_asignados where ticket_id = p_ticket_id;

  update tickets
  set area_id = p_area_id,
      proyecto_id = null,
      tipo_id = null,
      asignado_a = null,
      es_grupal = false,
      estado = 'pendiente',
      finalizado_at = null
  where id = p_ticket_id;

  if t.estado <> 'pendiente' then
    insert into ticket_status_history (ticket_id, estado, changed_by)
    values (p_ticket_id, 'pendiente', auth.uid());
  end if;
end;
$$;
