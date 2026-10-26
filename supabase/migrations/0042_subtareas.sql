-- Subtareas de una tarea: actividades con su propio responsable, estado y
-- tiempos (estimado y ejecutado), para saber cuánto dedicó cada persona.
--
-- Si una tarea tiene subtareas, sus tiempos dejan de escribirse a mano: un
-- trigger guarda en tickets la suma de las subtareas (tiempo propuesto =
-- estimado, tiempo ejecutado = ejecutado) y el avance (total y finalizadas),
-- para que el tablero y las estadísticas los lean sin consultas extra.
--
-- Las gestiona el equipo del área (puedo_gestionar_ticket); las ve quien
-- puede ver la tarea (puedo_ver_ticket). Ambas son security definer (0007),
-- así que estas policies no generan recursión con las de tickets.

create table if not exists ticket_subtareas (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) between 1 and 200),
  responsable_id uuid references profiles(id) on delete set null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_proceso', 'finalizada')),
  tiempo_estimado_horas numeric(8, 4) check (tiempo_estimado_horas >= 0),
  tiempo_ejecutado_horas numeric(8, 4) check (tiempo_ejecutado_horas >= 0),
  orden integer not null default 0,
  finalizada_at timestamptz,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ticket_subtareas_ticket_idx on ticket_subtareas(ticket_id, orden, created_at);
create index if not exists ticket_subtareas_responsable_idx on ticket_subtareas(responsable_id);

alter table ticket_subtareas enable row level security;

drop policy if exists ticket_subtareas_select on ticket_subtareas;
create policy ticket_subtareas_select on ticket_subtareas for select to authenticated
  using (public.puedo_ver_ticket(ticket_id));

drop policy if exists ticket_subtareas_write on ticket_subtareas;
create policy ticket_subtareas_write on ticket_subtareas for all to authenticated
  using (public.puedo_gestionar_ticket(ticket_id))
  with check (public.puedo_gestionar_ticket(ticket_id));

alter publication supabase_realtime add table ticket_subtareas;

-- Avance de la tarea, mantenido por el trigger de abajo.
alter table tickets
  add column if not exists subtareas_total integer not null default 0,
  add column if not exists subtareas_finalizadas integer not null default 0;

-- El responsable tiene que ser del equipo del área de la tarea; la fecha de
-- finalización se pone y se quita según el estado.
create or replace function public.preparar_subtarea()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.titulo := trim(new.titulo);
  new.updated_at := now();

  if new.responsable_id is not null
     and (tg_op = 'INSERT' or new.responsable_id is distinct from old.responsable_id)
     and not exists (
       select 1 from tickets t
       join area_miembros m on m.area_id = t.area_id and m.profile_id = new.responsable_id
       where t.id = new.ticket_id
     ) then
    raise exception 'El responsable debe ser del equipo del área de la tarea' using errcode = '22023';
  end if;

  if new.estado = 'finalizada' then
    new.finalizada_at := coalesce(case when tg_op = 'UPDATE' then old.finalizada_at end, now());
  else
    new.finalizada_at := null;
  end if;

  if tg_op = 'UPDATE' and new.ticket_id is distinct from old.ticket_id then
    raise exception 'Una subtarea no se mueve a otra tarea' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists ticket_subtareas_preparar on ticket_subtareas;
create trigger ticket_subtareas_preparar
  before insert or update on ticket_subtareas
  for each row execute procedure public.preparar_subtarea();

-- Guarda en tickets la suma de tiempos y el avance de sus subtareas. Si se
-- borran todas, los tiempos se conservan y vuelven a ser editables a mano.
create or replace function public.sincronizar_subtareas_ticket()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_ticket uuid := coalesce(new.ticket_id, old.ticket_id);
  v_total integer;
  v_finalizadas integer;
  v_estimado numeric;
  v_ejecutado numeric;
begin
  select count(*), count(*) filter (where estado = 'finalizada'),
         sum(tiempo_estimado_horas), sum(tiempo_ejecutado_horas)
  into v_total, v_finalizadas, v_estimado, v_ejecutado
  from ticket_subtareas where ticket_id = v_ticket;

  perform set_config('app.sincronizando_subtareas', '1', true);
  if v_total > 0 then
    update tickets
    set subtareas_total = v_total,
        subtareas_finalizadas = v_finalizadas,
        tiempo_propuesto_horas = v_estimado,
        tiempo_ejecutado_horas = v_ejecutado
    -- Solo si algo cambió, para no ensuciar el historial de cambios (0024).
    where id = v_ticket
      and (subtareas_total, subtareas_finalizadas, tiempo_propuesto_horas, tiempo_ejecutado_horas)
          is distinct from (v_total, v_finalizadas, v_estimado, v_ejecutado);
  else
    update tickets set subtareas_total = 0, subtareas_finalizadas = 0
    where id = v_ticket and subtareas_total <> 0;
  end if;
  perform set_config('app.sincronizando_subtareas', '', true);

  return null;
end;
$$;

drop trigger if exists ticket_subtareas_sincronizar on ticket_subtareas;
create trigger ticket_subtareas_sincronizar
  after insert or update or delete on ticket_subtareas
  for each row execute procedure public.sincronizar_subtareas_ticket();

-- Con subtareas, los tiempos de la tarea solo los escribe el trigger de
-- arriba; los cambios a mano (o los contadores) se ignoran.
create or replace function public.proteger_tiempos_con_subtareas()
returns trigger language plpgsql set search_path = public
as $$
begin
  if current_setting('app.sincronizando_subtareas', true) = '1' then
    return new;
  end if;
  new.subtareas_total := old.subtareas_total;
  new.subtareas_finalizadas := old.subtareas_finalizadas;
  if old.subtareas_total > 0 then
    new.tiempo_propuesto_horas := old.tiempo_propuesto_horas;
    new.tiempo_ejecutado_horas := old.tiempo_ejecutado_horas;
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_proteger_tiempos_con_subtareas on tickets;
create trigger tickets_proteger_tiempos_con_subtareas
  before update on tickets
  for each row execute procedure public.proteger_tiempos_con_subtareas();
