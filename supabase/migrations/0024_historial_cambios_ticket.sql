-- Trazabilidad de las tareas: cada cambio de un campo de negocio de un
-- ticket (y cada persona que entra o sale de una tarea en grupo) queda en
-- ticket_cambios con quién lo hizo, cuándo, y el valor anterior y el nuevo.
--
-- Lo llenan triggers, no el cliente: así no hay forma de editar una tarea
-- sin dejar rastro ni de insertar, cambiar o borrar entradas del historial
-- desde la API (la tabla no tiene policies de escritura). Los nombres de
-- proyecto, área y personas se guardan como texto para que el historial se
-- siga leyendo aunque después se renombren o eliminen.

create table if not exists ticket_cambios (
  id bigserial primary key,
  ticket_id uuid not null references tickets(id) on delete cascade,
  campo text not null,
  valor_anterior text,
  valor_nuevo text,
  changed_by uuid references profiles(id) on delete set null default auth.uid(),
  changed_at timestamptz not null default now()
);

create index if not exists ticket_cambios_ticket_idx on ticket_cambios(ticket_id, changed_at);

alter table ticket_cambios enable row level security;

drop policy if exists ticket_cambios_select on ticket_cambios;
create policy ticket_cambios_select on ticket_cambios for select to authenticated using (
  public.puedo_ver_ticket(ticket_id)
);

create or replace function public.nombre_perfil(p_id uuid)
returns text language sql stable security definer set search_path = public
as $$
  select coalesce(full_name, email) from profiles where id = p_id;
$$;

create or replace function public.registrar_cambios_ticket()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  autor uuid := auth.uid();
begin
  if new.titulo is distinct from old.titulo then
    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo, changed_by)
    values (new.id, 'titulo', old.titulo, new.titulo, autor);
  end if;

  if new.descripcion is distinct from old.descripcion then
    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo, changed_by)
    values (new.id, 'descripcion', old.descripcion, new.descripcion, autor);
  end if;

  if new.prioridad is distinct from old.prioridad then
    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo, changed_by)
    values (new.id, 'prioridad', old.prioridad, new.prioridad, autor);
  end if;

  if new.estado is distinct from old.estado then
    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo, changed_by)
    values (new.id, 'estado', old.estado, new.estado, autor);
  end if;

  if new.fecha_requerida is distinct from old.fecha_requerida then
    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo, changed_by)
    values (
      new.id, 'fecha_requerida',
      to_char(old.fecha_requerida at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      to_char(new.fecha_requerida at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      autor
    );
  end if;

  if new.asignado_a is distinct from old.asignado_a then
    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo, changed_by)
    values (new.id, 'asignado_a', public.nombre_perfil(old.asignado_a), public.nombre_perfil(new.asignado_a), autor);
  end if;

  if new.es_grupal is distinct from old.es_grupal then
    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo, changed_by)
    values (new.id, 'es_grupal', old.es_grupal::text, new.es_grupal::text, autor);
  end if;

  if new.area_id is distinct from old.area_id then
    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo, changed_by)
    values (
      new.id, 'area',
      (select nombre from areas where id = old.area_id),
      (select nombre from areas where id = new.area_id),
      autor
    );
  end if;

  if new.proyecto_id is distinct from old.proyecto_id then
    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo, changed_by)
    values (
      new.id, 'proyecto',
      (select nombre from proyectos where id = old.proyecto_id),
      (select nombre from proyectos where id = new.proyecto_id),
      autor
    );
  end if;

  if new.tiempo_propuesto_horas is distinct from old.tiempo_propuesto_horas then
    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo, changed_by)
    values (new.id, 'tiempo_propuesto_horas', old.tiempo_propuesto_horas::text, new.tiempo_propuesto_horas::text, autor);
  end if;

  if new.tiempo_ejecutado_horas is distinct from old.tiempo_ejecutado_horas then
    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo, changed_by)
    values (new.id, 'tiempo_ejecutado_horas', old.tiempo_ejecutado_horas::text, new.tiempo_ejecutado_horas::text, autor);
  end if;

  if new.nota_finalizacion is distinct from old.nota_finalizacion then
    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo, changed_by)
    values (new.id, 'nota_finalizacion', old.nota_finalizacion, new.nota_finalizacion, autor);
  end if;

  return new;
end;
$$;

drop trigger if exists tickets_registrar_cambios on tickets;
create trigger tickets_registrar_cambios
  after update on tickets
  for each row execute procedure public.registrar_cambios_ticket();

-- Personas que entran o salen de una tarea en grupo.
create or replace function public.registrar_cambios_asignados()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo)
    values (new.ticket_id, 'miembro', null, public.nombre_perfil(new.profile_id));
    return new;
  end if;

  -- Al eliminar el ticket, el cascade borra sus asignados: no hay nada que
  -- registrar (y el insert fallaría por la FK al ticket que ya no existe).
  if exists (select 1 from tickets where id = old.ticket_id) then
    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo)
    values (old.ticket_id, 'miembro', public.nombre_perfil(old.profile_id), null);
  end if;
  return old;
end;
$$;

drop trigger if exists ticket_asignados_registrar_cambios on ticket_asignados;
create trigger ticket_asignados_registrar_cambios
  after insert or delete on ticket_asignados
  for each row execute procedure public.registrar_cambios_asignados();
