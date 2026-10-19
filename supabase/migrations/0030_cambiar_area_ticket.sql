-- Corregir el área de una tarea enviada al área equivocada. Solo el
-- superadmin puede hacerlo, y solo con cambiar_area_ticket(): la tarea llega
-- a la bandeja del área nueva como si recién se hubiera pedido allí.
--
-- La policy tickets_update_gestores (0022) dejaba a un líder o agente cambiar
-- area_id a otra área que también gestione; el trigger lo cierra para todos
-- menos el superadmin. Sin auth.uid() (service role, SQL editor) se permite.

create or replace function public.proteger_area_ticket()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.area_id is distinct from old.area_id
     and auth.uid() is not null
     and not public.es_superadmin() then
    raise exception 'Solo un administrador puede cambiar el área de una tarea' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_proteger_area on tickets;
create trigger tickets_proteger_area
  before update of area_id on tickets
  for each row execute procedure public.proteger_area_ticket();

-- Los proyectos y las personas asignadas son del área anterior, así que se
-- quitan; la tarea vuelve a pendiente y sin asignar. Comentarios, archivos,
-- tiempos e historial se conservan (el cambio queda en ticket_cambios por el
-- trigger de 0024).
create or replace function public.cambiar_area_ticket(p_ticket_id uuid, p_area_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  t tickets%rowtype;
begin
  if not public.es_superadmin() then
    raise exception 'Solo un administrador puede cambiar el área de una tarea' using errcode = '42501';
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

revoke all on function public.cambiar_area_ticket(uuid, uuid) from public, anon;
grant execute on function public.cambiar_area_ticket(uuid, uuid) to authenticated;
