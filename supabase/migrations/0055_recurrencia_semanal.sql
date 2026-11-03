-- Repetición en días de la semana (amplía la 0048).
--
-- recurrencia_frecuencia = 'semanal' + recurrencia_dias_semana: los días
-- elegidos, 1 = lunes … 7 = domingo (isodow). Un solo día = cada semana ese
-- día; varios = una copia en cada uno. Como en las demás, la copia se crea a
-- las 6:00 a. m. de Colombia y el plazo cuenta desde ese día. El título de
-- la copia lleva el día de la semana y la fecha completa.

alter table tickets
  add column if not exists recurrencia_dias_semana smallint[]
    check (recurrencia_dias_semana <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]);

alter table tickets drop constraint if exists tickets_recurrencia_frecuencia_check;
alter table tickets add constraint tickets_recurrencia_frecuencia_check
  check (recurrencia_frecuencia in ('mensual', 'diaria', 'habil', 'semanal'));

-- Igual que la de 0048, más los días de la semana.
create or replace function public.siguiente_fecha_recurrencia(
  p_frecuencia text, p_dia smallint, p_dias smallint[], p_desde timestamptz
)
returns timestamptz language plpgsql stable
as $$
declare
  local timestamp := p_desde at time zone 'America/Bogota';
  candidato timestamp;
begin
  if p_frecuencia <> 'semanal' then
    return public.siguiente_fecha_recurrencia(p_frecuencia, p_dia, p_desde);
  end if;
  if coalesce(cardinality(p_dias), 0) = 0 then
    return null;
  end if;

  candidato := local::date + time '06:00';
  if candidato < local then
    candidato := candidato + interval '1 day';
  end if;
  while not (extract(isodow from candidato)::smallint = any(p_dias)) loop
    candidato := candidato + interval '1 day';
  end loop;
  return candidato at time zone 'America/Bogota';
end;
$$;

create or replace function public.describir_frecuencia(p_frecuencia text, p_dia smallint, p_dias smallint[])
returns text language sql immutable
as $$
  select case
    when p_frecuencia = 'semanal' then
      'semanal (' || coalesce((
        select string_agg((array['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO'])[d], ', ' order by d)
        from unnest(p_dias) as d
      ), '') || ')'
    else public.describir_frecuencia(p_frecuencia, p_dia)
  end;
$$;

-- Igual que en 0048, con la validación y el cálculo de los días de la semana.
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
  if new.recurrencia_frecuencia = 'semanal' then
    new.recurrencia_dias_semana := (
      select array_agg(distinct d order by d) from unnest(new.recurrencia_dias_semana) as d
    );
    if coalesce(cardinality(new.recurrencia_dias_semana), 0) = 0 then
      raise exception 'Elige al menos un día de la semana en que se repite' using errcode = '22023';
    end if;
  end if;

  if tg_op = 'INSERT'
     or not old.recurrencia_activa
     or new.recurrencia_frecuencia is distinct from old.recurrencia_frecuencia
     or (new.recurrencia_frecuencia = 'mensual' and new.recurrencia_dia is distinct from old.recurrencia_dia)
     or (new.recurrencia_frecuencia = 'semanal' and new.recurrencia_dias_semana is distinct from old.recurrencia_dias_semana) then
    new.recurrencia_proxima := public.siguiente_fecha_recurrencia(
      new.recurrencia_frecuencia, new.recurrencia_dia, new.recurrencia_dias_semana, now());
  else
    new.recurrencia_proxima := old.recurrencia_proxima;
  end if;
  return new;
end;
$$;

-- Igual que en 0048, con los días de la semana en la frase del historial.
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
    frase := format('activó la repetición %s',
      public.describir_frecuencia(new.recurrencia_frecuencia, new.recurrencia_dia, new.recurrencia_dias_semana));
  elsif not new.recurrencia_activa and old.recurrencia_activa then
    frase := 'desactivó la repetición';
  elsif new.recurrencia_activa and (
    new.recurrencia_frecuencia is distinct from old.recurrencia_frecuencia
    or (new.recurrencia_frecuencia = 'mensual' and new.recurrencia_dia is distinct from old.recurrencia_dia)
    or (new.recurrencia_frecuencia = 'semanal' and new.recurrencia_dias_semana is distinct from old.recurrencia_dias_semana)
  ) then
    frase := format('cambió la repetición de %s a %s',
      public.describir_frecuencia(old.recurrencia_frecuencia, old.recurrencia_dia, old.recurrencia_dias_semana),
      public.describir_frecuencia(new.recurrencia_frecuencia, new.recurrencia_dia, new.recurrencia_dias_semana));
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
  after update of recurrencia_activa, recurrencia_frecuencia, recurrencia_dia, recurrencia_dias_semana, recurrencia_plazo_dias on tickets
  for each row execute procedure public.registrar_cambio_recurrencia();

-- Igual que en 0048; en las semanales el título lleva también el día de la
-- semana ("lunes 3 de noviembre 2026").
create or replace function public.generar_tickets_recurrentes()
returns integer language plpgsql security definer set search_path = public
as $$
declare
  meses constant text[] := array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  dias constant text[] := array['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
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
    if b.recurrencia_frecuencia = 'semanal' then
      v_sufijo := dias[extract(isodow from v_local)::int] || ' ' || v_sufijo;
    end if;
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
      b.numero, public.describir_frecuencia(b.recurrencia_frecuencia, b.recurrencia_dia, b.recurrencia_dias_semana)), null);

    -- Si se saltaron días (el cron no corrió), una sola copia y a la próxima fecha futura.
    update tickets
    set recurrencia_proxima = public.siguiente_fecha_recurrencia(
      b.recurrencia_frecuencia, b.recurrencia_dia, b.recurrencia_dias_semana,
      greatest(b.recurrencia_proxima, now()) + interval '1 minute')
    where id = b.id;

    v_creados := v_creados + 1;
  end loop;

  perform set_config('app.generando_recurrencia', '', true);
  return v_creados;
end;
$$;

revoke all on function public.generar_tickets_recurrentes() from public, anon, authenticated;
