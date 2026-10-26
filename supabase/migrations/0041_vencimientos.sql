-- Vencimientos y alertas.
--
-- fecha_compromiso: fecha y hora en que el equipo del área se compromete a
-- terminar la tarea. El vencimiento se mide contra ella o, si el equipo no la
-- definió, contra fecha_requerida (el "para cuándo" de quien pidió la tarea).
--
-- Cada 15 minutos pg_cron llama a la Edge Function notify-vencimientos, que
-- ejecuta revisar_vencimientos(): registra las alertas de 24 h, 4 h y
-- vencida (una vez por fecha objetivo), crea las notificaciones de la
-- campanita y devuelve las nuevas para que la función envíe los correos.

alter table tickets add column if not exists fecha_compromiso timestamptz;

-- No se puede programar una fecha que ya pasó. Solo se valida cuando la
-- fecha cambia: una tarea vencida se puede seguir editando.
create or replace function public.validar_fechas_ticket()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.fecha_compromiso is not null
     and (tg_op = 'INSERT' or new.fecha_compromiso is distinct from old.fecha_compromiso)
     and new.fecha_compromiso <= now() then
    raise exception 'La fecha compromiso debe ser posterior a este momento' using errcode = '22023';
  end if;

  if new.fecha_requerida is not null
     and (tg_op = 'INSERT' or new.fecha_requerida is distinct from old.fecha_requerida)
     and new.fecha_requerida <= now() then
    raise exception 'La fecha requerida ya pasó' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists tickets_validar_fechas on tickets;
create trigger tickets_validar_fechas
  before insert or update of fecha_compromiso, fecha_requerida on tickets
  for each row execute procedure public.validar_fechas_ticket();

-- Historial de cambios (0024) para la fecha compromiso.
create or replace function public.registrar_cambio_fecha_compromiso()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo, changed_by)
  values (
    new.id, 'fecha_compromiso',
    to_char(old.fecha_compromiso at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    to_char(new.fecha_compromiso at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    auth.uid()
  );
  return new;
end;
$$;

drop trigger if exists tickets_registrar_fecha_compromiso on tickets;
create trigger tickets_registrar_fecha_compromiso
  after update of fecha_compromiso on tickets
  for each row
  when (new.fecha_compromiso is distinct from old.fecha_compromiso)
  execute procedure public.registrar_cambio_fecha_compromiso();

-- Alertas ya enviadas. La fecha objetivo es parte de la llave: si la
-- reprograman, las alertas vuelven a salir para la fecha nueva.
create table if not exists alertas_vencimiento (
  ticket_id uuid not null references tickets(id) on delete cascade,
  tipo text not null check (tipo in ('24h', '4h', 'vencido')),
  fecha_objetivo timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (ticket_id, tipo, fecha_objetivo)
);

alter table alertas_vencimiento enable row level security;
revoke all on alertas_vencimiento from anon, authenticated;

alter table notificaciones drop constraint if exists notificaciones_tipo_check;
alter table notificaciones add constraint notificaciones_tipo_check
  check (tipo in ('mencion', 'comentario', 'asignacion', 'estado', 'aprobacion', 'rechazo', 'solicitud_rechazada', 'vencimiento'));

-- Revisa las tareas abiertas y registra la alerta de la etapa en que están
-- (solo la más reciente: una tarea creada con 2 h de plazo no recibe la de
-- 24 h). Avisa a quien la pidió y a sus responsables o, si no tiene, a los
-- líderes del área. Devuelve las alertas nuevas para el correo.
create or replace function public.revisar_vencimientos()
returns table (ticket_id uuid, tipo text, fecha_objetivo timestamptz)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  r record;
  destinatario uuid;
begin
  for r in
    insert into alertas_vencimiento (ticket_id, tipo, fecha_objetivo)
    select t.id,
           case
             when objetivo <= now() then 'vencido'
             when objetivo <= now() + interval '4 hours' then '4h'
             else '24h'
           end,
           objetivo
    from tickets t
    cross join lateral (select coalesce(t.fecha_compromiso, t.fecha_requerida) as objetivo) o
    where t.estado in ('pendiente', 'en_curso')
      and objetivo is not null
      and objetivo <= now() + interval '24 hours'
    on conflict do nothing
    returning alertas_vencimiento.ticket_id, alertas_vencimiento.tipo, alertas_vencimiento.fecha_objetivo
  loop
    for destinatario in
      select distinct d from (
        select t.solicitante_id as d from tickets t where t.id = r.ticket_id
        union select t.asignado_a from tickets t where t.id = r.ticket_id
        union select a.profile_id from ticket_asignados a where a.ticket_id = r.ticket_id
        union
        select m.profile_id
        from tickets t
        join area_miembros m on m.area_id = t.area_id and m.rol = 'lider'
        where t.id = r.ticket_id
          and t.asignado_a is null
          and not exists (select 1 from ticket_asignados a where a.ticket_id = t.id)
      ) involucrados
      where d is not null
    loop
      perform public.notificar(destinatario, 'vencimiento', r.ticket_id, null, r.tipo);
    end loop;

    ticket_id := r.ticket_id;
    tipo := r.tipo;
    fecha_objetivo := r.fecha_objetivo;
    return next;
  end loop;
end;
$$;

revoke all on function public.revisar_vencimientos() from public, anon, authenticated;
grant execute on function public.revisar_vencimientos() to service_role;

-- Programación: cada 15 minutos se llama a la Edge Function. La URL y la
-- llave van en Vault (no en este archivo); se crean una vez a mano:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/notify-vencimientos', 'vencimientos_url');
--   select vault.create_secret('<la misma llave del secreto VENCIMIENTOS_CRON_KEY>', 'vencimientos_cron_key');
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('revisar-vencimientos')
where exists (select 1 from cron.job where jobname = 'revisar-vencimientos');

select cron.schedule(
  'revisar-vencimientos',
  '*/15 * * * *',
  $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'vencimientos_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'vencimientos_cron_key')
      ),
      body := '{}'::jsonb
    )
    where exists (select 1 from vault.decrypted_secrets where name = 'vencimientos_url');
  $cron$
);
