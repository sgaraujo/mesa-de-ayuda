-- Fix: la policy de tickets consulta ticket_asignados, y la de
-- ticket_asignados consultaba tickets de vuelta → "infinite recursion
-- detected in policy" (se manifestaba como 500 al leer /tickets).
--
-- Se rompe el ciclo con una función security definer: como su dueño es
-- el mismo dueño de las tablas, sus consultas internas no vuelven a
-- disparar RLS, así que ticket_asignados_select puede usarla sin volver
-- a evaluar la policy de tickets.

create function public.puedo_ver_ticket(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from tickets t
    where t.id = p_ticket_id
      and (
        t.solicitante_id = auth.uid()
        or public.rol_actual() = 'admin'
        or (
          public.rol_actual() = 'agente'
          and (
            t.asignado_a = auth.uid()
            or t.asignado_a is null
            or exists (
              select 1 from ticket_asignados ta
              where ta.ticket_id = t.id and ta.profile_id = auth.uid()
            )
          )
        )
      )
  );
$$;

drop policy ticket_asignados_select on ticket_asignados;

create policy ticket_asignados_select on ticket_asignados for select to authenticated using (
  public.puedo_ver_ticket(ticket_id)
);
