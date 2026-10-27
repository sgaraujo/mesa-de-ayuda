-- Repetición diaria (amplía la 0044, que solo era mensual).
--
-- recurrencia_frecuencia:
--   'mensual' → el día recurrencia_dia (1-28) de cada mes, como antes.
--   'diaria'  → todos los días.
--   'habil'   → de lunes a viernes (no descuenta festivos).
-- En todas, la copia se crea a las 6:00 a. m. de Colombia (el cron de la
-- 0044 corre a las 6:05 y no cambia). En las diarias, recurrencia_dia queda
-- sin usar y el título de la copia lleva la fecha completa en vez del mes.
-- El plazo (recurrencia_plazo_dias) funciona igual: 0 = ese mismo día.

alter table tickets
  add column if not exists recurrencia_frecuencia text not null default 'mensual'
    check (recurrencia_frecuencia in ('mensual', 'diaria', 'habil'));

-- Primer momento, desde p_desde (incluido), que toca según la frecuencia,
-- a las 6:00 a. m. de Colombia.
create or replace function public.siguiente_fecha_recurrencia(p_frecuencia text, p_dia smallint, p_desde timestamptz)
returns timestamptz language plpgsql stable
as $$
declare
  local timestamp := p_desde at time zone 'America/Bogota';
  candidato timestamp;
begin
  if p_frecuencia = 'mensual' then
    return public.siguiente_fecha_recurrencia(p_dia, p_desde);
  end if;

  candidato := local::date + time '06:00';
  if candidato < local then
    candidato := candidato + interval '1 day';
  end if;
  -- Días hábiles: sábado (6) y domingo (0) pasan al lunes.
  while p_frecuencia = 'habil' and extract(dow from candidato) in (0, 6) loop
    candidato := candidato + interval '1 day';
  end loop;
  return candidato at time zone 'America/Bogota';
end;
$$;

create or replace function public.describir_frecuencia(p_frecuencia text, p_dia smallint)
returns text language sql immutable
as $$
  select case p_frecuencia
    when 'diaria' then 'diaria'
    when 'habil' then 'en días hábiles'
    else format('mensual (día %s)', p_dia)
  end;
$$;

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
  if new.recurrencia_frecuencia = 'mensual' and new.recurrencia_dia is null then
    raise exception 'Indica el día del mes en que se repite' using errcode = '22023';
  end if;

  if tg_op = 'INSERT'
     or not old.recurrencia_activa
     or new.recurrencia_frecuencia is distinct from old.recurrencia_frecuencia
     or (new.recurrencia_frecuencia = 'mensual' and new.recurrencia_dia is distinct from old.recurrencia_dia) then
    new.recurrencia_proxima := public.siguiente_fecha_recurrencia(new.recurrencia_frecuencia, new.recurrencia_dia, now());
  else
    new.recurrencia_proxima := old.recurrencia_proxima;
  end if;
  return new;
end;
$$;

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
    frase := format('activó la repetición %s', public.describir_frecuencia(new.recurrencia_frecuencia, new.recurrencia_dia));
  elsif not new.recurrencia_activa and old.recurrencia_activa then
    frase := 'desactivó la repetición';
  elsif new.recurrencia_activa and (
    new.recurrencia_frecuencia is distinct from old.recurrencia_frecuencia
    or (new.recurrencia_frecuencia = 'mensual' and new.recurrencia_dia is distinct from old.recurrencia_dia)
  ) then
    frase := format('cambió la repetición de %s a %s',
      public.describir_frecuencia(old.recurrencia_frecuencia, old.recurrencia_dia),
      public.describir_frecuencia(new.recurrencia_frecuencia, new.recurrencia_dia));
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
  after update of recurrencia_activa, recurrencia_frecuencia, recurrencia_dia, recurrencia_plazo_dias on tickets
  for each row execute procedure public.registrar_cambio_recurrencia();

-- Igual que en la 0044, con el título y la próxima fecha según la frecuencia.
create or replace function public.generar_tickets_recurrentes()
returns integer language plpgsql security definer set search_path = public
as $$
declare
  meses constant text[] := array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  b tickets%rowtype;
  v_local timestamp;
  v_sufijo text;
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
    v_sufijo := case
      when b.recurrencia_frecuencia = 'mensual'
        then meses[extract(month from v_local)::int] || ' ' || extract(year from v_local)::int
      else extract(day from v_local)::int || ' de ' || meses[extract(month from v_local)::int] || ' ' || extract(year from v_local)::int
    end;
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
      b.titulo || ' — ' || v_sufijo,
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
    values (v_nuevo, 'recurrencia', null, format('se generó automáticamente de la tarea #%s (repetición %s)',
      b.numero, public.describir_frecuencia(b.recurrencia_frecuencia, b.recurrencia_dia)), null);

    -- Si se saltaron días (el cron no corrió), una sola copia y a la próxima fecha futura.
    update tickets
    set recurrencia_proxima = public.siguiente_fecha_recurrencia(
      b.recurrencia_frecuencia, b.recurrencia_dia, greatest(b.recurrencia_proxima, now()) + interval '1 minute')
    where id = b.id;

    v_creados := v_creados + 1;
  end loop;

  perform set_config('app.generando_recurrencia', '', true);
  return v_creados;
end;
$$;

revoke all on function public.generar_tickets_recurrentes() from public, anon, authenticated;
