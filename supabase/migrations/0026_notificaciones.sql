-- Centro de notificaciones dentro de la app.
--
-- Las notificaciones las crean triggers, no el cliente ni las Edge Functions:
-- así quedan registradas aunque el correo no salga (Graph caído, navegador
-- cerrado justo después de comentar, etc.). Tipos:
--   mencion     alguien te mencionó (@) en un comentario
--   comentario  comentaron una tarea que pediste o que tienes asignada
--   asignacion  te asignaron una tarea (individual o en grupo)
--   estado      cambió el estado de una solicitud tuya (incluye finalizada)
-- Nunca se notifica a quien hizo la acción.

create table if not exists notificaciones (
  id uuid primary key default gen_random_uuid(),
  destinatario_id uuid not null references profiles(id) on delete cascade,
  tipo text not null check (tipo in ('mencion', 'comentario', 'asignacion', 'estado')),
  ticket_id uuid not null references tickets(id) on delete cascade,
  comentario_id uuid references ticket_comentarios(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  -- Extracto del comentario o el estado nuevo, según el tipo.
  detalle text,
  leida_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notificaciones_destinatario_idx
  on notificaciones(destinatario_id, created_at desc);
create index if not exists notificaciones_no_leidas_idx
  on notificaciones(destinatario_id) where leida_at is null;

alter table notificaciones enable row level security;

-- Cada quien ve solo las suyas. No hay policies de escritura: se crean por
-- trigger y se marcan como leídas con marcar_notificaciones_leidas().
drop policy if exists notificaciones_select on notificaciones;
create policy notificaciones_select on notificaciones for select to authenticated using (
  destinatario_id = auth.uid()
);

create or replace function public.marcar_notificaciones_leidas(p_ids uuid[] default null)
returns void language sql security definer set search_path = public
as $$
  update notificaciones
  set leida_at = now()
  where destinatario_id = auth.uid()
    and leida_at is null
    and (p_ids is null or id = any(p_ids));
$$;

revoke all on function public.marcar_notificaciones_leidas(uuid[]) from public, anon;
grant execute on function public.marcar_notificaciones_leidas(uuid[]) to authenticated;

-- Inserta una notificación salvo que el destinatario sea quien actúa o no
-- esté activo.
create or replace function public.notificar(
  p_destinatario uuid, p_tipo text, p_ticket uuid, p_actor uuid,
  p_detalle text default null, p_comentario uuid default null
)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_destinatario is null or p_destinatario is not distinct from p_actor then
    return;
  end if;
  if not exists (select 1 from profiles where id = p_destinatario and activo) then
    return;
  end if;
  insert into notificaciones (destinatario_id, tipo, ticket_id, comentario_id, actor_id, detalle)
  values (p_destinatario, p_tipo, p_ticket, p_comentario, p_actor, p_detalle);
end;
$$;

revoke all on function public.notificar(uuid, text, uuid, uuid, text, uuid) from public, anon, authenticated;

-- Comentario nuevo: avisa a quien pidió la tarea y a quienes la tienen
-- asignada.
create or replace function public.notificar_comentario()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  t tickets%rowtype;
  destinatario uuid;
begin
  select * into t from tickets where id = new.ticket_id;
  for destinatario in
    select distinct d from (
      select t.solicitante_id as d
      union select t.asignado_a
      union select profile_id from ticket_asignados where ticket_id = new.ticket_id
    ) involucrados
    where d is not null
  loop
    perform public.notificar(destinatario, 'comentario', new.ticket_id, new.autor_id, left(new.texto, 280), new.id);
  end loop;
  return new;
end;
$$;

drop trigger if exists ticket_comentarios_notificar on ticket_comentarios;
create trigger ticket_comentarios_notificar
  after insert on ticket_comentarios
  for each row execute procedure public.notificar_comentario();

-- Mención: reemplaza el aviso genérico de "comentario" de ese mismo
-- comentario (las menciones se insertan justo después del comentario, en
-- comentar_ticket()) para no avisar dos veces lo mismo.
create or replace function public.notificar_mencion()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  c ticket_comentarios%rowtype;
begin
  select * into c from ticket_comentarios where id = new.comentario_id;
  delete from notificaciones
  where comentario_id = new.comentario_id
    and destinatario_id = new.profile_id
    and tipo = 'comentario';
  perform public.notificar(new.profile_id, 'mencion', new.ticket_id, c.autor_id, left(c.texto, 280), c.id);
  return new;
end;
$$;

drop trigger if exists ticket_menciones_notificar on ticket_menciones;
create trigger ticket_menciones_notificar
  after insert on ticket_menciones
  for each row execute procedure public.notificar_mencion();

-- Asignación individual (al crear la tarea ya asignada o al reasignarla) y
-- cambios de estado para quien la pidió.
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

  if tg_op = 'UPDATE' and new.estado is distinct from old.estado then
    perform public.notificar(new.solicitante_id, 'estado', new.id, actor, new.estado);
  end if;

  return new;
end;
$$;

drop trigger if exists tickets_notificar on tickets;
create trigger tickets_notificar
  after insert or update of asignado_a, estado on tickets
  for each row execute procedure public.notificar_cambios_ticket();

-- Asignación a una tarea en grupo.
create or replace function public.notificar_asignado_grupo()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.notificar(new.profile_id, 'asignacion', new.ticket_id, auth.uid());
  return new;
end;
$$;

drop trigger if exists ticket_asignados_notificar on ticket_asignados;
create trigger ticket_asignados_notificar
  after insert on ticket_asignados
  for each row execute procedure public.notificar_asignado_grupo();

-- Tiempo real: la campanita se actualiza sin recargar.
do $$
begin
  alter publication supabase_realtime add table public.notificaciones;
exception
  when duplicate_object then null;
end $$;
