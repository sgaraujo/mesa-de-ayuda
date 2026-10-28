-- Aprobación automática de la finalización (0032).
--
-- Si quien pidió la tarea no la aprueba ni la rechaza en 2 horas desde que
-- se finalizó, se aprueba sola. pg_cron ejecuta cada 5 minutos
-- aprobar_finalizaciones_vencidas(), que la marca aprobada con
-- aprobacion_automatica = true y avisa por la campanita al solicitante y a
-- los responsables (notificación 'aprobacion' con detalle 'automatica').

alter table tickets
  add column if not exists aprobacion_automatica boolean not null default false;

-- Igual que en 0032; además el cliente tampoco escribe aprobacion_automatica.
create or replace function public.controlar_aprobacion_ticket()
returns trigger language plpgsql set search_path = public
as $$
begin
  if current_setting('app.respondiendo_finalizacion', true) = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.aprobacion := null;
    new.aprobacion_at := null;
    new.aprobacion_automatica := false;
    return new;
  end if;

  new.aprobacion := old.aprobacion;
  new.aprobacion_at := old.aprobacion_at;
  new.aprobacion_automatica := old.aprobacion_automatica;

  if new.estado is distinct from old.estado then
    if new.estado = 'finalizado' then
      new.aprobacion_automatica := false;
      if auth.uid() is not null and auth.uid() = new.solicitante_id then
        new.aprobacion := 'aprobada';
        new.aprobacion_at := now();
      else
        new.aprobacion := null;
        new.aprobacion_at := null;
      end if;
    elsif old.estado = 'finalizado' then
      -- La reabrió el equipo: ya no hay nada que aprobar.
      new.aprobacion := null;
      new.aprobacion_at := null;
      new.aprobacion_automatica := false;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.aprobar_finalizaciones_vencidas()
returns int language plpgsql security definer set search_path = public
as $$
declare
  t tickets%rowtype;
  destinatario uuid;
  total int := 0;
begin
  perform set_config('app.respondiendo_finalizacion', '1', true);

  for t in
    update tickets
    set aprobacion = 'aprobada',
        aprobacion_at = now(),
        aprobacion_automatica = true
    where estado = 'finalizado'
      and aprobacion is null
      and finalizado_at is not null
      and finalizado_at <= now() - interval '2 hours'
    returning *
  loop
    total := total + 1;
    for destinatario in
      select distinct d from (
        select t.solicitante_id as d
        union select t.asignado_a
        union select profile_id from ticket_asignados where ticket_id = t.id
      ) involucrados
      where d is not null
    loop
      perform public.notificar(destinatario, 'aprobacion', t.id, null, 'automatica');
    end loop;
  end loop;

  perform set_config('app.respondiendo_finalizacion', '', true);
  return total;
end;
$$;

revoke all on function public.aprobar_finalizaciones_vencidas() from public, anon, authenticated;

select cron.unschedule('aprobar-finalizaciones')
where exists (select 1 from cron.job where jobname = 'aprobar-finalizaciones');

select cron.schedule('aprobar-finalizaciones', '*/5 * * * *', $cron$ select public.aprobar_finalizaciones_vencidas(); $cron$);
