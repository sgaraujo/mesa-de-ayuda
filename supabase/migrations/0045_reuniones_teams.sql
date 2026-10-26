-- Reuniones de Teams como tareas (evidencia de las reuniones agendadas).
--
-- La Edge Function sincronizar-teams (pg_cron, cada 15 minutos) lee con
-- Microsoft Graph (permiso Calendars.Read de aplicación) los calendarios de
-- los líderes y agentes y, por cada reunión de Teams que organizan, llama a
-- registrar_reunion_teams(). Cada reunión es una tarea del proyecto
-- "Reuniones" del área del organizador (se crea si no existe):
--   agendada   → Pendiente, a cargo del organizador
--   terminada  → Finalizada y aprobada, con la duración como tiempo ejecutado
--   cancelada  → Rechazada ("La reunión se canceló en Teams")
-- reuniones_teams evita duplicados. Si alguien borra la tarea, la reunión no
-- se vuelve a importar.

create table if not exists reuniones_teams (
  -- iCalUId del evento: el mismo en el calendario de todos los invitados.
  evento_id text primary key,
  ticket_id uuid references tickets(id) on delete set null,
  organizador_id uuid references profiles(id) on delete set null,
  inicio timestamptz not null,
  fin timestamptz not null,
  created_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);

create index if not exists reuniones_teams_ticket_idx on reuniones_teams(ticket_id);

alter table reuniones_teams enable row level security;
revoke all on reuniones_teams from anon, authenticated;

-- Enlace para unirse, que el detalle muestra como botón.
alter table tickets add column if not exists reunion_url text;

create or replace function public.registrar_reunion_teams(
  p_evento_id text,
  p_organizador uuid,
  p_area uuid,
  p_titulo text,
  p_descripcion text,
  p_inicio timestamptz,
  p_fin timestamptz,
  p_cancelada boolean,
  p_url text
)
returns text language plpgsql security definer set search_path = public
as $$
declare
  r reuniones_teams%rowtype;
  t tickets%rowtype;
  v_ticket uuid;
  v_proyecto uuid;
  v_titulo text := left(coalesce(nullif(trim(p_titulo), ''), 'Reunión sin asunto'), 140);
  v_horas numeric := round(greatest(extract(epoch from (p_fin - p_inicio)) / 3600, 0)::numeric, 4);
begin
  select * into r from reuniones_teams where evento_id = p_evento_id for update;

  if found and r.ticket_id is null then
    return 'descartada';
  end if;

  if not found then
    if p_cancelada then
      return 'sin_cambios';
    end if;

    insert into proyectos (nombre, area_id) values ('Reuniones', p_area)
    on conflict (area_id, nombre) do nothing;
    select id into v_proyecto from proyectos where area_id = p_area and nombre = 'Reuniones';

    insert into tickets (
      titulo, descripcion, solicitante_id, empresa_solicitante, area_id, proyecto_id,
      prioridad, asignado_a, estado, tiempo_propuesto_horas, reunion_url
    )
    select v_titulo, p_descripcion, p.id, p.empresa, p_area, v_proyecto,
           'media', p.id, 'pendiente', v_horas, p_url
    from profiles p where p.id = p_organizador
    returning id into v_ticket;

    if v_ticket is null then
      return 'sin_organizador';
    end if;

    insert into ticket_status_history (ticket_id, estado, changed_by) values (v_ticket, 'pendiente', null);
    insert into reuniones_teams (evento_id, ticket_id, organizador_id, inicio, fin)
    values (p_evento_id, v_ticket, p_organizador, p_inicio, p_fin);
    select * into t from tickets where id = v_ticket;
  else
    select * into t from tickets where id = r.ticket_id;
    update reuniones_teams set inicio = p_inicio, fin = p_fin, actualizado_at = now()
    where evento_id = p_evento_id;
  end if;

  -- Solo se toca mientras está abierta: lo que el equipo ya cerró no cambia.
  if t.estado not in ('pendiente', 'en_curso') then
    return 'sin_cambios';
  end if;

  if p_cancelada then
    perform set_config('app.rechazando_ticket', '1', true);
    update tickets set estado = 'rechazado', motivo_rechazo = 'La reunión se canceló en Teams'
    where id = t.id;
    perform set_config('app.rechazando_ticket', '', true);
    insert into ticket_status_history (ticket_id, estado, changed_by) values (t.id, 'rechazado', null);
    return 'cancelada';
  end if;

  -- Reprogramada o editada en Outlook.
  update tickets
  set titulo = v_titulo,
      descripcion = p_descripcion,
      reunion_url = p_url,
      tiempo_propuesto_horas = case when coalesce(subtareas_total, 0) = 0 then v_horas else tiempo_propuesto_horas end
  where id = t.id
    and (titulo, descripcion, reunion_url, tiempo_propuesto_horas)
        is distinct from (v_titulo, p_descripcion, p_url, case when coalesce(t.subtareas_total, 0) = 0 then v_horas else t.tiempo_propuesto_horas end);

  if p_fin > now() then
    return case when r.evento_id is null then 'creada' else 'actualizada' end;
  end if;

  -- Terminó: se finaliza aprobada (la pidió el mismo organizador; 0032 se
  -- salta con la marca de responder_finalizacion).
  perform set_config('app.respondiendo_finalizacion', '1', true);
  update tickets
  set estado = 'finalizado',
      finalizado_at = p_fin,
      aprobacion = 'aprobada',
      aprobacion_at = now(),
      tiempo_ejecutado_horas = case when coalesce(subtareas_total, 0) = 0 then v_horas else tiempo_ejecutado_horas end
  where id = t.id;
  perform set_config('app.respondiendo_finalizacion', '', true);
  insert into ticket_status_history (ticket_id, estado, changed_by) values (t.id, 'finalizado', null);
  return 'finalizada';
end;
$$;

revoke all on function public.registrar_reunion_teams(text, uuid, uuid, text, text, timestamptz, timestamptz, boolean, text)
  from public, anon, authenticated;
grant execute on function public.registrar_reunion_teams(text, uuid, uuid, text, text, timestamptz, timestamptz, boolean, text)
  to service_role;

-- Cada 15 minutos. URL y llave en Vault, como en 0041:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/sincronizar-teams', 'teams_sync_url');
--   select vault.create_secret('<la misma llave del secreto TEAMS_CRON_KEY>', 'teams_sync_key');
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('sincronizar-teams')
where exists (select 1 from cron.job where jobname = 'sincronizar-teams');

select cron.schedule(
  'sincronizar-teams',
  '*/15 * * * *',
  $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'teams_sync_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'teams_sync_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    )
    where exists (select 1 from vault.decrypted_secrets where name = 'teams_sync_url');
  $cron$
);
