-- Subtareas (0042): visibilidad, aviso de asignación e historial.
--
-- 1. Un agente ve solo lo que tiene asignado y la bandeja general (0025).
--    Quien es responsable de una subtarea pasa a ver también esa tarea, para
--    poder abrirla y registrar sus horas (igual que una mención).
-- 2. Al asignar una subtarea, su responsable recibe una notificación.
-- 3. Crear, cambiar o borrar una subtarea queda en ticket_cambios (0024) con
--    campo 'subtarea' y la frase ya armada en valor_nuevo.

create or replace function public.tengo_subtarea(p_ticket_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from ticket_subtareas
    where ticket_id = p_ticket_id and responsable_id = auth.uid()
  );
$$;

-- Igual que en 0025, más tengo_subtarea().
create or replace function public.puedo_ver_ticket(p_ticket_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.usuario_activo() and exists (
    select 1 from tickets t
    where t.id = p_ticket_id
      and (
        public.es_superadmin()
        or t.solicitante_id = auth.uid()
        or public.rol_en_area(t.area_id) = 'lider'
        or (
          public.rol_en_area(t.area_id) = 'agente'
          and (
            t.asignado_a = auth.uid() or t.asignado_a is null
            or exists (select 1 from ticket_asignados ta where ta.ticket_id = t.id and ta.profile_id = auth.uid())
          )
        )
        or public.fui_mencionado(t.id)
        or public.tengo_subtarea(t.id)
      )
  );
$$;

drop policy if exists tickets_select on tickets;
create policy tickets_select on tickets for select to authenticated using (
  public.usuario_activo() and (
    public.es_superadmin()
    or solicitante_id = auth.uid()
    or public.rol_en_area(area_id) = 'lider'
    or (
      public.rol_en_area(area_id) = 'agente'
      and (
        asignado_a = auth.uid()
        or asignado_a is null
        or exists (select 1 from ticket_asignados ta where ta.ticket_id = tickets.id and ta.profile_id = auth.uid())
      )
    )
    or public.fui_mencionado(id)
    or public.tengo_subtarea(id)
  )
);

-- Aviso de asignación: detalle = título de la subtarea.
alter table notificaciones drop constraint if exists notificaciones_tipo_check;
alter table notificaciones add constraint notificaciones_tipo_check
  check (tipo in ('mencion', 'comentario', 'asignacion', 'estado', 'aprobacion', 'rechazo', 'solicitud_rechazada', 'vencimiento', 'subtarea'));

create or replace function public.notificar_subtarea()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.responsable_id is not null
     and (tg_op = 'INSERT' or new.responsable_id is distinct from old.responsable_id) then
    perform public.notificar(new.responsable_id, 'subtarea', new.ticket_id, auth.uid(), left(new.titulo, 280));
  end if;
  return null;
end;
$$;

drop trigger if exists ticket_subtareas_notificar on ticket_subtareas;
create trigger ticket_subtareas_notificar
  after insert or update of responsable_id on ticket_subtareas
  for each row execute procedure public.notificar_subtarea();

-- Historial. Las horas se escriben como "1.5 h"; los nombres, como texto
-- (igual que 0024, para que se sigan leyendo si la persona se elimina).
create or replace function public.texto_horas(p_horas numeric)
returns text language sql immutable
as $$
  select case when p_horas is null then 'sin definir' else trim(to_char(p_horas, 'FM99990.##')) || ' h' end;
$$;

create or replace function public.texto_estado_subtarea(p_estado text)
returns text language sql immutable
as $$
  select case p_estado
    when 'pendiente' then 'Pendiente'
    when 'en_proceso' then 'En proceso'
    when 'finalizada' then 'Finalizada'
    else p_estado
  end;
$$;

create or replace function public.registrar_cambios_subtarea()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_ticket uuid := coalesce(new.ticket_id, old.ticket_id);
  v_titulo text := '«' || coalesce(new.titulo, old.titulo) || '»';
  frases text[] := '{}';
  frase text;
begin
  -- Al borrar la tarea entera sus subtareas se borran en cascada: ya no hay
  -- dónde registrar nada.
  if not exists (select 1 from tickets where id = v_ticket) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    frases := array[format('agregó la subtarea %s', v_titulo)
      || case when new.responsable_id is not null then format(' para %s', public.nombre_perfil(new.responsable_id)) else '' end];
  elsif tg_op = 'DELETE' then
    frases := array[format('eliminó la subtarea %s (%s ejecutadas)', v_titulo, public.texto_horas(coalesce(old.tiempo_ejecutado_horas, 0)))];
  else
    if new.titulo is distinct from old.titulo then
      frases := frases || format('renombró la subtarea «%s» a «%s»', old.titulo, new.titulo);
    end if;
    if new.estado is distinct from old.estado then
      frases := frases || format('pasó la subtarea %s de «%s» a «%s»', v_titulo,
        public.texto_estado_subtarea(old.estado), public.texto_estado_subtarea(new.estado));
    end if;
    if new.responsable_id is distinct from old.responsable_id then
      frases := frases || format('cambió el responsable de la subtarea %s de «%s» a «%s»', v_titulo,
        coalesce(public.nombre_perfil(old.responsable_id), 'Sin responsable'),
        coalesce(public.nombre_perfil(new.responsable_id), 'Sin responsable'));
    end if;
    if new.tiempo_ejecutado_horas is distinct from old.tiempo_ejecutado_horas then
      frases := frases || format('cambió las horas ejecutadas de la subtarea %s de %s a %s', v_titulo,
        public.texto_horas(old.tiempo_ejecutado_horas), public.texto_horas(new.tiempo_ejecutado_horas));
    end if;
    if new.tiempo_estimado_horas is distinct from old.tiempo_estimado_horas then
      frases := frases || format('cambió las horas estimadas de la subtarea %s de %s a %s', v_titulo,
        public.texto_horas(old.tiempo_estimado_horas), public.texto_horas(new.tiempo_estimado_horas));
    end if;
  end if;

  foreach frase in array frases loop
    insert into ticket_cambios (ticket_id, campo, valor_anterior, valor_nuevo, changed_by)
    values (v_ticket, 'subtarea', null, frase, auth.uid());
  end loop;

  return null;
end;
$$;

drop trigger if exists ticket_subtareas_registrar_cambios on ticket_subtareas;
create trigger ticket_subtareas_registrar_cambios
  after insert or update or delete on ticket_subtareas
  for each row execute procedure public.registrar_cambios_subtarea();
