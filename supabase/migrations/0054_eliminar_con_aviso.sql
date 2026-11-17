-- Eliminar una tarea con otras personas involucradas exige motivo y les avisa.
--
-- Hasta ahora el líder del área (o el superadmin) borraba la tarea sin que
-- nadie se enterara: quien la pidió y sus responsables solo veían que
-- desaparecía, y sus notificaciones se borraban con ella. Ahora se elimina
-- solo con eliminar_ticket():
--   · Involucrados = quien la creó (solicitante_id) y sus responsables
--     (asignado_a y ticket_asignados), sin contar a quien elimina.
--   · Sin involucrados (la creó quien la elimina y nadie más la tiene), se
--     borra como antes, sin motivo ni aviso.
--   · Con involucrados, el motivo es obligatorio; se registra en
--     tickets_eliminados y cada uno recibe la notificación 'eliminada' en la
--     campanita (sin ticket_id, porque la tarea ya no existe; el número y el
--     título van en ticket_referencia) y el correo de notify-eliminacion.

create table if not exists tickets_eliminados (
  id uuid primary key default gen_random_uuid(),
  -- Sin llave foránea: la tarea ya no existe.
  ticket_id uuid not null,
  numero int not null,
  titulo text not null,
  area_id uuid references areas(id) on delete set null,
  solicitante_id uuid references profiles(id) on delete set null,
  eliminado_por uuid references profiles(id) on delete set null,
  motivo text not null,
  notificados uuid[] not null default '{}',
  -- Lo marca notify-eliminacion para no enviar el correo dos veces.
  correo_enviado_at timestamptz,
  eliminado_at timestamptz not null default now()
);

alter table tickets_eliminados enable row level security;

-- Registro de consulta para el superadmin y el líder del área. Sin policies
-- de escritura: solo lo llena eliminar_ticket().
drop policy if exists tickets_eliminados_select on tickets_eliminados;
create policy tickets_eliminados_select on tickets_eliminados for select to authenticated using (
  public.usuario_activo()
  and (public.es_superadmin() or coalesce(public.rol_en_area(area_id) = 'lider', false))
);

-- La notificación de una tarea eliminada no puede apuntar a ella.
alter table notificaciones alter column ticket_id drop not null;
alter table notificaciones add column if not exists ticket_referencia text;

alter table notificaciones drop constraint if exists notificaciones_tipo_check;
alter table notificaciones add constraint notificaciones_tipo_check
  check (tipo in (
    'mencion', 'comentario', 'asignacion', 'estado', 'aprobacion',
    'rechazo', 'solicitud_rechazada', 'vencimiento', 'subtarea', 'eliminada'
  ));

-- Devuelve el id del registro en tickets_eliminados si hubo a quién avisar
-- (para enviar el correo), o null si se borró sin aviso.
create or replace function public.eliminar_ticket(p_ticket_id uuid, p_motivo text default null)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  t tickets%rowtype;
  motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  involucrados uuid[];
  v_registro_id uuid;
begin
  select * into t from tickets where id = p_ticket_id for update;
  if not found or not public.usuario_activo()
     or not (public.es_superadmin() or coalesce(public.rol_en_area(t.area_id) = 'lider', false)) then
    raise exception 'Solo el líder del área puede eliminar esta tarea' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct p.id), '{}') into involucrados
  from profiles p
  where p.activo
    and p.id is distinct from auth.uid()
    and (
      p.id = t.solicitante_id
      or p.id = t.asignado_a
      or exists (select 1 from ticket_asignados ta where ta.ticket_id = t.id and ta.profile_id = p.id)
    );

  if cardinality(involucrados) > 0 then
    if motivo is null then
      raise exception 'Indica por qué eliminas la tarea' using errcode = '22023';
    end if;
    if length(motivo) > 4000 then
      raise exception 'El motivo es demasiado largo' using errcode = '22023';
    end if;

    insert into tickets_eliminados (ticket_id, numero, titulo, area_id, solicitante_id, eliminado_por, motivo, notificados)
    values (t.id, t.numero, t.titulo, t.area_id, t.solicitante_id, auth.uid(), motivo, involucrados)
    returning id into v_registro_id;

    insert into notificaciones (destinatario_id, tipo, ticket_id, actor_id, detalle, ticket_referencia)
    select d, 'eliminada', null, auth.uid(), left(motivo, 280), '#' || t.numero || ' ' || t.titulo
    from unnest(involucrados) as d;
  end if;

  delete from tickets where id = p_ticket_id;
  return v_registro_id;
end;
$$;

revoke all on function public.eliminar_ticket(uuid, text) from public, anon;
grant execute on function public.eliminar_ticket(uuid, text) to authenticated;

-- El cliente ya no borra directo: así ninguna eliminación se salta el aviso.
drop policy if exists tickets_delete_lider on tickets;
