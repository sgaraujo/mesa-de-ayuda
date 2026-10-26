-- El equipo de un área puede rechazar una solicitud que no va a atender
-- (no le corresponde, está duplicada, no es viable...). Siempre con un motivo,
-- que le llega a quien la pidió.
--
-- 'rechazado' es un estado final como 'finalizado', pero la tarea sale del
-- tablero: solo queda en Mis solicitudes de quien la pidió. Se rechaza con
-- rechazar_ticket(); el cliente no puede poner el estado a mano.

alter table tickets drop constraint if exists tickets_estado_check;
alter table tickets add constraint tickets_estado_check
  check (estado in ('pendiente', 'en_curso', 'finalizado', 'rechazado'));

alter table ticket_status_history drop constraint if exists ticket_status_history_estado_check;
alter table ticket_status_history add constraint ticket_status_history_estado_check
  check (estado in ('pendiente', 'en_curso', 'finalizado', 'rechazado'));

alter table tickets add column if not exists motivo_rechazo text;

-- Solo rechazar_ticket() entra a 'rechazado' y escribe el motivo. Si alguien
-- la reabre, el motivo se limpia.
create or replace function public.controlar_rechazo_ticket()
returns trigger language plpgsql set search_path = public
as $$
begin
  if current_setting('app.rechazando_ticket', true) = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.estado = 'rechazado' then
      raise exception 'Una solicitud no se crea rechazada' using errcode = '42501';
    end if;
    new.motivo_rechazo := null;
    return new;
  end if;

  if new.estado = 'rechazado' and old.estado is distinct from 'rechazado' then
    raise exception 'Para rechazar una solicitud usa rechazar_ticket()' using errcode = '42501';
  end if;

  new.motivo_rechazo := case when new.estado = 'rechazado' then old.motivo_rechazo end;
  return new;
end;
$$;

drop trigger if exists tickets_controlar_rechazo on tickets;
create trigger tickets_controlar_rechazo
  before insert or update on tickets
  for each row execute procedure public.controlar_rechazo_ticket();

alter table notificaciones drop constraint if exists notificaciones_tipo_check;
alter table notificaciones add constraint notificaciones_tipo_check
  check (tipo in ('mencion', 'comentario', 'asignacion', 'estado', 'aprobacion', 'rechazo', 'solicitud_rechazada'));

-- El aviso genérico de cambio de estado no se envía al rechazar:
-- rechazar_ticket() manda el suyo, con el motivo.
create or replace function public.notificar_cambios_ticket()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  actor uuid := coalesce(auth.uid(), new.solicitante_id);
begin
  if new.asignado_a is not null
     and (tg_op = 'INSERT' or new.asignado_a is distinct from old.asignado_a) then
    perform public.notificar(new.asignado_a, 'asignacion', new.id, actor);
  end if;

  if tg_op = 'UPDATE' and new.estado is distinct from old.estado and new.estado <> 'rechazado' then
    perform public.notificar(new.solicitante_id, 'estado', new.id, actor, new.estado);
  end if;

  return new;
end;
$$;

-- Correo de rechazo a quien pidió la tarea (notify-finalizacion).
alter table ticket_email_notifications drop constraint if exists ticket_email_notifications_notification_type_check;
alter table ticket_email_notifications add constraint ticket_email_notifications_notification_type_check
  check (notification_type in ('nueva', 'asignacion', 'finalizado', 'rechazado'));

create or replace function public.rechazar_ticket(p_ticket_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  t tickets%rowtype;
  motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_comentario_id uuid;
begin
  select * into t from tickets where id = p_ticket_id for update;
  if not found or not public.usuario_activo() or not public.puedo_gestionar_ticket(p_ticket_id) then
    raise exception 'Solo el equipo del área puede rechazar esta solicitud' using errcode = '42501';
  end if;
  if t.estado in ('finalizado', 'rechazado') then
    raise exception 'Esta solicitud ya está cerrada' using errcode = '22023';
  end if;
  if motivo is null then
    raise exception 'Indica por qué rechazas la solicitud' using errcode = '22023';
  end if;
  if length(motivo) > 4000 then
    raise exception 'El motivo es demasiado largo' using errcode = '22023';
  end if;

  perform set_config('app.rechazando_ticket', '1', true);
  update tickets
  set estado = 'rechazado', motivo_rechazo = motivo, finalizado_at = null
  where id = p_ticket_id;
  perform set_config('app.rechazando_ticket', '', true);

  insert into ticket_status_history (ticket_id, estado, changed_by)
  values (p_ticket_id, 'rechazado', auth.uid());

  -- El motivo queda también en los comentarios (trazabilidad). Su aviso
  -- genérico de "comentario" se reemplaza por el de rechazo.
  insert into ticket_comentarios (ticket_id, autor_id, texto)
  values (p_ticket_id, auth.uid(), left('Rechazó la solicitud: ' || motivo, 5000))
  returning id into v_comentario_id;
  delete from notificaciones where comentario_id = v_comentario_id and tipo = 'comentario';

  perform public.notificar(t.solicitante_id, 'solicitud_rechazada', p_ticket_id, auth.uid(), left(motivo, 280), v_comentario_id);
end;
$$;

revoke all on function public.rechazar_ticket(uuid, text) from public, anon;
grant execute on function public.rechazar_ticket(uuid, text) to authenticated;
