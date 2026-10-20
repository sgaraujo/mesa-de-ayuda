-- Aprobación de la finalización por quien pidió la tarea.
--
-- Al finalizarse, la tarea queda "por aprobar" (aprobacion null). Quien la
-- pidió la aprueba o la rechaza con un motivo con responder_finalizacion();
-- si la rechaza, vuelve a Pendiente con los mismos responsables y queda
-- marcada como 'rechazada' hasta que la vuelvan a finalizar.
--
-- Si quien finaliza es el mismo solicitante, se aprueba sola.

alter table tickets
  add column if not exists aprobacion text check (aprobacion in ('aprobada', 'rechazada')),
  add column if not exists aprobacion_at timestamptz;

-- Las tareas ya finalizadas antes de esto se dan por aprobadas.
update tickets
set aprobacion = 'aprobada', aprobacion_at = coalesce(finalizado_at, now())
where estado = 'finalizado' and aprobacion is null;

-- El cliente no escribe la aprobación (tickets_update_gestores deja a los
-- agentes actualizar cualquier columna): la calcula este trigger según el
-- estado, y solo responder_finalizacion() la fija a mano.
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
    return new;
  end if;

  new.aprobacion := old.aprobacion;
  new.aprobacion_at := old.aprobacion_at;

  if new.estado is distinct from old.estado then
    if new.estado = 'finalizado' then
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
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tickets_controlar_aprobacion on tickets;
create trigger tickets_controlar_aprobacion
  before insert or update on tickets
  for each row execute procedure public.controlar_aprobacion_ticket();

-- Nuevos tipos de notificación para los responsables.
alter table notificaciones drop constraint if exists notificaciones_tipo_check;
alter table notificaciones add constraint notificaciones_tipo_check
  check (tipo in ('mencion', 'comentario', 'asignacion', 'estado', 'aprobacion', 'rechazo'));

create or replace function public.responder_finalizacion(p_ticket_id uuid, p_aprobar boolean, p_motivo text default null)
returns void language plpgsql security definer set search_path = public
as $$
declare
  t tickets%rowtype;
  motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_comentario_id uuid;
  destinatario uuid;
begin
  select * into t from tickets where id = p_ticket_id for update;
  if not found or t.solicitante_id <> auth.uid() or not public.usuario_activo() then
    raise exception 'Solo quien pidió la tarea puede aprobarla o rechazarla' using errcode = '42501';
  end if;
  if t.estado <> 'finalizado' or t.aprobacion is not null then
    raise exception 'Esta tarea no está esperando aprobación' using errcode = '22023';
  end if;
  if not p_aprobar and motivo is null then
    raise exception 'Indica por qué rechazas la finalización' using errcode = '22023';
  end if;
  if length(motivo) > 4000 then
    raise exception 'El motivo es demasiado largo' using errcode = '22023';
  end if;

  perform set_config('app.respondiendo_finalizacion', '1', true);

  if p_aprobar then
    update tickets set aprobacion = 'aprobada', aprobacion_at = now() where id = p_ticket_id;
  else
    update tickets
    set estado = 'pendiente',
        finalizado_at = null,
        aprobacion = 'rechazada',
        aprobacion_at = now()
    where id = p_ticket_id;

    insert into ticket_status_history (ticket_id, estado, changed_by)
    values (p_ticket_id, 'pendiente', auth.uid());

    -- Cuando la vuelvan a finalizar, el correo de notify-finalizacion debe
    -- salir otra vez (su registro evita repetir el aviso por tarea).
    delete from ticket_email_notifications
    where ticket_id = p_ticket_id and notification_type = 'finalizado';
  end if;

  perform set_config('app.respondiendo_finalizacion', '', true);

  -- La respuesta queda en los comentarios (trazabilidad). Su aviso genérico
  -- de "comentario" se reemplaza por el de aprobación o rechazo.
  if motivo is not null then
    insert into ticket_comentarios (ticket_id, autor_id, texto)
    values (
      p_ticket_id,
      auth.uid(),
      left((case when p_aprobar then 'Aprobó la finalización: ' else 'Rechazó la finalización: ' end) || motivo, 5000)
    )
    returning id into v_comentario_id;
    delete from notificaciones where comentario_id = v_comentario_id and tipo = 'comentario';
  end if;

  for destinatario in
    select distinct d from (
      select t.asignado_a as d
      union select profile_id from ticket_asignados where ticket_id = p_ticket_id
    ) responsables
    where d is not null
  loop
    perform public.notificar(
      destinatario,
      case when p_aprobar then 'aprobacion' else 'rechazo' end,
      p_ticket_id,
      auth.uid(),
      left(motivo, 280),
      v_comentario_id
    );
  end loop;
end;
$$;

revoke all on function public.responder_finalizacion(uuid, boolean, text) from public, anon;
grant execute on function public.responder_finalizacion(uuid, boolean, text) to authenticated;
