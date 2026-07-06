-- Cada agente debe tener su propio tablero, no compartido con los demás
-- agentes de su misma área. Antes veían todos los tickets de su área;
-- ahora solo ven los que tienen asignados a ellos mismos, más la bandeja
-- general (sin asignar) para poder tomar trabajo nuevo. Admin sigue viendo
-- todo, sin cambios.

drop policy tickets_select on tickets;

create policy tickets_select on tickets for select to authenticated using (
  solicitante_id = auth.uid()
  or public.rol_actual() = 'admin'
  or (public.rol_actual() = 'agente' and (asignado_a = auth.uid() or asignado_a is null))
);

drop policy ticket_status_history_select on ticket_status_history;

create policy ticket_status_history_select on ticket_status_history for select to authenticated using (
  exists (
    select 1 from tickets t
    where t.id = ticket_id
      and (
        t.solicitante_id = auth.uid()
        or public.rol_actual() = 'admin'
        or (public.rol_actual() = 'agente' and (t.asignado_a = auth.uid() or t.asignado_a is null))
      )
  )
);

-- ya no la usa ninguna policy
drop function if exists public.area_actual();
