-- Tareas recurrentes (mensuales).
--
-- Una tarea puede marcarse como plantilla de repetición: cada mes, el día
-- indicado (1-28, para que exista en todos los meses), se crea una copia con
-- su título, descripción, área, proyecto, tipo, prioridad, solicitante,
-- responsables y subtareas. La copia lleva el mes en el título y apunta a la
-- original (recurrencia_origen). Con recurrencia_plazo_dias, la copia recibe
-- una fecha compromiso (0041) de esos días después de generarse.
--
-- La genera generar_tickets_recurrentes(), que pg_cron ejecuta a diario a las
-- 6:00 a. m. de Colombia. La configuración la cambia el equipo del área
-- (policy de update de tickets); los triggers calculan la próxima fecha.

alter table tickets
  add column if not exists recurrencia_activa boolean not null default false,
  add column if not exists recurrencia_dia smallint check (recurrencia_dia between 1 and 28),
  add column if not exists recurrencia_plazo_dias smallint check (recurrencia_plazo_dias between 0 and 90),
  add column if not exists recurrencia_proxima timestamptz,
  add column if not exists recurrencia_origen uuid references tickets(id) on delete set null;

create index if not exists tickets_recurrencia_proxima_idx on tickets(recurrencia_proxima) where recurrencia_activa;
create index if not exists tickets_recurrencia_origen_idx on tickets(recurrencia_origen);

-- Primer momento, desde p_desde (incluido), en que cae el día p_dia a las
-- 6:00 a. m. de Colombia.
create or replace function public.siguiente_fecha_recurrencia(p_dia smallint, p_desde timestamptz)
returns timestamptz language plpgsql stable
as $$
declare
  local timestamp := p_desde at time zone 'America/Bogota';
  candidato timestamp := make_timestamp(extract(year from local)::int, extract(month from local)::int, p_dia, 6, 0, 0);
begin
  if candidato < local then
    candidato := candidato + interval '1 month';
  end if;
  return candidato at time zone 'America/Bogota';
end;
$$;

-- Valida la configuración y calcula la próxima fecha cuando se activa o se
-- cambia el día. La próxima fecha solo la mueve el generador.
create or replace function public.preparar_recurrencia()
returns trigger language plpgsql set search_path = public
as $$
begin
  if current_setting('app.generando_recurrencia', true) = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.recurrencia_proxima := null;
  end if;

  if not new.recurrencia_activa then
    new.recurrencia_proxima := null;
    return new;
  end if;

  if new.recurrencia_origen is not null then
    raise exception 'Una tarea generada por repetición no puede repetirse; configura la original' using errcode = '22023';
  end if;
  if new.recurrencia_dia is null then
    raise exception 'Indica el día del mes en que se repite' using errcode = '22023';
  end if;

  if tg_op = 'INSERT'
     or not old.recurrencia_activa
     or new.recurrencia_dia is distinct from old.recurrencia_dia then
    new.recurrencia_proxima := public.siguiente_fecha_recurrencia(new.recurrencia_dia, now());
  else
    new.recurrencia_proxima := old.recurrencia_proxima;
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_preparar_recurrencia on tickets;
create trigger tickets_preparar_recurrencia
  before insert or update on tickets
  for each row execute procedure public.preparar_recurrencia();

-- Historial (0024): activar, cambiar o desactivar la repetición. Como en
-- 0043, la frase va armada en valor_nuevo.
create or replace function public.registrar_cambio_recurrencia()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  frase text;
begin
  if current_setting('app.generando_recurrencia', true) = '1' then
    return null;
  end if;

  if new.recurrencia_activa and not old.recurrencia_activa then
    frase := format('activó la repetición mensual (día %s)', new.recurrencia_dia);
  elsif not new.recurrencia_activa and old.recurrencia_activa then
    frase := 'desactivó la repetición mensual';
  elsif new.recurrencia_activa and new.recurrencia_dia is distinct from old.recurrencia_dia then
    frase := format('cambió el día de la repetición mensual del %s al %s', old.recurrencia_dia, new.recurrencia_dia);
  end if;

  if new.recurrencia_activa and new.recurrencia_plazo_dias is distinct from old.recurrencia_plazo_dias then
    frase := concat_ws('; ', frase, format('cambió el plazo de las copias a %s',
      coalesce(new.recurrencia_plazo_dias || ' días', 'sin plazo')));
  end if;

  if frase is not null then
    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo, changed_by)
    values (new.id, 'recurrencia', null, frase, auth.uid());
  end if;
  return null;
end;
$$;

drop trigger if exists tickets_registrar_recurrencia on tickets;
create trigger tickets_registrar_recurrencia
  after update of recurrencia_activa, recurrencia_dia, recurrencia_plazo_dias on tickets
  for each row execute procedure public.registrar_cambio_recurrencia();

-- Crea las copias pendientes. Si se saltó algún mes (p. ej. el cron no
-- corrió), genera una sola copia y pasa a la próxima fecha futura, para no
-- llenar el tablero de golpe. Devuelve cuántas creó.
create or replace function public.generar_tickets_recurrentes()
returns integer language plpgsql security definer set search_path = public
as $$
declare
  meses constant text[] := array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  b tickets%rowtype;
  v_local timestamp;
  v_nuevo uuid;
  v_compromiso timestamptz;
  v_creados integer := 0;
begin
  perform set_config('app.generando_recurrencia', '1', true);

  for b in
    select * from tickets
    where recurrencia_activa
      and recurrencia_proxima <= now()
      and estado <> 'rechazado'
    for update skip locked
  loop
    v_local := b.recurrencia_proxima at time zone 'America/Bogota';
    v_compromiso := case
      when b.recurrencia_plazo_dias is null then null
      -- Final del día del plazo, hora de Colombia.
      else greatest(
        ((v_local::date + b.recurrencia_plazo_dias) + time '23:59') at time zone 'America/Bogota',
        now() + interval '1 hour'
      )
    end;

    insert into tickets (
      titulo, descripcion, solicitante_id, empresa_solicitante, area_id, proyecto_id, tipo_id,
      prioridad, es_grupal, asignado_a, estado, tiempo_propuesto_horas, archivo_url,
      fecha_compromiso, recurrencia_origen
    )
    values (
      b.titulo || ' — ' || meses[extract(month from v_local)::int] || ' ' || extract(year from v_local)::int,
      b.descripcion, b.solicitante_id, b.empresa_solicitante, b.area_id, b.proyecto_id, b.tipo_id,
      b.prioridad, b.es_grupal, case when b.es_grupal then null else b.asignado_a end, 'pendiente',
      -- Con subtareas, el tiempo propuesto lo recalcula el trigger de 0042.
      case when coalesce(b.subtareas_total, 0) = 0 then b.tiempo_propuesto_horas end,
      b.archivo_url, v_compromiso, b.id
    )
    returning id into v_nuevo;

    insert into ticket_asignados (ticket_id, profile_id)
    select v_nuevo, profile_id from ticket_asignados where ticket_id = b.id;

    -- Responsables que ya no son del área quedan sin asignar (0042 lo exige).
    insert into ticket_subtareas (ticket_id, titulo, responsable_id, tiempo_estimado_horas, orden)
    select v_nuevo, s.titulo,
           case when exists (
             select 1 from area_miembros m where m.area_id = b.area_id and m.profile_id = s.responsable_id
           ) then s.responsable_id end,
           s.tiempo_estimado_horas, s.orden
    from ticket_subtareas s
    where s.ticket_id = b.id;

    insert into ticket_status_history (ticket_id, estado, changed_by)
    values (v_nuevo, 'pendiente', null);

    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo, changed_by)
    values (v_nuevo, 'recurrencia', null, format('se generó automáticamente de la tarea #%s (repetición mensual)', b.numero), null);

    update tickets
    set recurrencia_proxima = public.siguiente_fecha_recurrencia(b.recurrencia_dia, greatest(b.recurrencia_proxima, now()) + interval '1 day')
    where id = b.id;

    v_creados := v_creados + 1;
  end loop;

  perform set_config('app.generando_recurrencia', '', true);
  return v_creados;
end;
$$;

revoke all on function public.generar_tickets_recurrentes() from public, anon, authenticated;

-- 6:05 a. m. de Colombia (11:05 UTC), cinco minutos después de la hora de las copias.
create extension if not exists pg_cron;

select cron.unschedule('generar-tickets-recurrentes')
where exists (select 1 from cron.job where jobname = 'generar-tickets-recurrentes');

select cron.schedule('generar-tickets-recurrentes', '5 11 * * *', $cron$ select public.generar_tickets_recurrentes(); $cron$);
