-- Estadísticas por actividad real del período, no solo por fecha de creación.
--
-- Antes, /estadisticas filtraba todo por tickets.created_at: una tarea creada
-- el 06/11 y finalizada el 13/11 no contaba en la semana del 09/11 al 15/11,
-- aunque se trabajó y cerró en ella. Esta función le da al cliente, para las
-- tareas de unas áreas y un período:
--
--   · actividad: la tarea tuvo movimiento ese día (un cambio registrado en
--     ticket_cambios, un cambio de estado o un comentario). Con ella se
--     cuentan las "actualizadas".
--   · horas: la suma, ese día, de cada cambio de tickets.tiempo_ejecutado_horas
--     ocurrido en el período, con su diferencia (después − antes). Con
--     subtareas, ese tiempo lo recalcula un trigger, así que también queda
--     registrado. Lo que el historial no explica (horas puestas al crear la
--     tarea, que el trigger de 0024 no registra, o anteriores a esa
--     migración) se ubica en la fecha de finalización o, si no hay, en la de
--     creación. Así la suma de todas las filas sin límite de fechas es igual
--     al tiempo ejecutado actual de cada tarea.
--
-- Corre con los permisos de quien consulta (security invoker): RLS de
-- tickets, ticket_cambios, ticket_status_history y ticket_comentarios decide
-- qué ve cada persona, igual que el resto de la página.

create index if not exists ticket_cambios_campo_ticket_idx
  on ticket_cambios(campo, ticket_id, changed_at);
create index if not exists ticket_cambios_changed_at_idx
  on ticket_cambios(changed_at);
create index if not exists ticket_status_history_changed_at_idx
  on ticket_status_history(changed_at);
create index if not exists ticket_comentarios_created_at_idx
  on ticket_comentarios(created_at);

create or replace function public.actividad_tickets(
  p_areas uuid[],
  p_desde timestamptz default null,
  p_hasta timestamptz default null
)
returns table (ticket_id uuid, dia date, horas numeric, actividad boolean)
language sql stable set search_path = public
as $$
  with t as (
    select id, created_at, finalizado_at, coalesce(tiempo_ejecutado_horas, 0) as horas
    from tickets
    where area_id = any(p_areas)
  ),
  cambios_horas as (
    select c.ticket_id,
           c.changed_at,
           coalesce(nullif(c.valor_nuevo, '')::numeric, 0)
             - coalesce(nullif(c.valor_anterior, '')::numeric, 0) as delta
    from ticket_cambios c
    join t on t.id = c.ticket_id
    where c.campo = 'tiempo_ejecutado_horas'
  ),
  resto as (
    select t.id as ticket_id,
           coalesce(t.finalizado_at, t.created_at) as fecha,
           t.horas - coalesce(sum(ch.delta), 0) as horas
    from t
    left join cambios_horas ch on ch.ticket_id = t.id
    group by t.id, t.finalizado_at, t.created_at, t.horas
  ),
  actividad as (
    select c.ticket_id, c.changed_at as fecha
    from ticket_cambios c join t on t.id = c.ticket_id
    where (p_desde is null or c.changed_at >= p_desde)
      and (p_hasta is null or c.changed_at <= p_hasta)
    union all
    select h.ticket_id, h.changed_at
    from ticket_status_history h join t on t.id = h.ticket_id
    where (p_desde is null or h.changed_at >= p_desde)
      and (p_hasta is null or h.changed_at <= p_hasta)
    union all
    select k.ticket_id, k.created_at
    from ticket_comentarios k join t on t.id = k.ticket_id
    where (p_desde is null or k.created_at >= p_desde)
      and (p_hasta is null or k.created_at <= p_hasta)
  ),
  filas as (
    select ch.ticket_id, ch.changed_at as fecha, ch.delta as horas, false as actividad
    from cambios_horas ch
    where ch.delta <> 0
      and (p_desde is null or ch.changed_at >= p_desde)
      and (p_hasta is null or ch.changed_at <= p_hasta)
    union all
    select r.ticket_id, r.fecha, r.horas, false
    from resto r
    where r.horas <> 0
      and (p_desde is null or r.fecha >= p_desde)
      and (p_hasta is null or r.fecha <= p_hasta)
    union all
    select a.ticket_id, a.fecha, 0, true
    from actividad a
  )
  -- Una fila por tarea y día (hora de Colombia): única, para paginar con
  -- seguridad, y con menos filas que los cambios sueltos.
  select f.ticket_id,
         (f.fecha at time zone 'America/Bogota')::date as dia,
         sum(f.horas) as horas,
         bool_or(f.actividad) as actividad
  from filas f
  group by 1, 2
  order by 1, 2;
$$;

revoke all on function public.actividad_tickets(uuid[], timestamptz, timestamptz) from public, anon;
grant execute on function public.actividad_tickets(uuid[], timestamptz, timestamptz) to authenticated;
