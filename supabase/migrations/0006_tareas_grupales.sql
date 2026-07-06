-- Tareas en grupo: varias personas específicas asignadas a un mismo ticket,
-- en vez de un solo asignado_a.

alter table tickets add column es_grupal boolean not null default false;

create table ticket_asignados (
  ticket_id uuid not null references tickets(id) on delete cascade,
  profile_id uuid not null references profiles(id),
  primary key (ticket_id, profile_id)
);

alter table ticket_asignados enable row level security;

-- Visible a quien ya puede ver el ticket (mismo criterio que tickets_select).
create policy ticket_asignados_select on ticket_asignados for select to authenticated using (
  exists (
    select 1 from tickets t
    where t.id = ticket_id
      and (
        t.solicitante_id = auth.uid()
        or public.rol_actual() = 'admin'
        or (
          public.rol_actual() = 'agente'
          and (
            t.asignado_a = auth.uid()
            or t.asignado_a is null
            or exists (
              select 1 from ticket_asignados ta2
              where ta2.ticket_id = t.id and ta2.profile_id = auth.uid()
            )
          )
        )
      )
  )
);

-- Solo agentes/admin arman la lista de asignados de un grupo.
create policy ticket_asignados_write on ticket_asignados for all to authenticated
  using (public.rol_actual() in ('agente', 'admin'))
  with check (public.rol_actual() in ('agente', 'admin'));

-- tickets_select y ticket_status_history_select deben incluir también los
-- tickets grupales donde el agente aparece en ticket_asignados.
drop policy tickets_select on tickets;

create policy tickets_select on tickets for select to authenticated using (
  solicitante_id = auth.uid()
  or public.rol_actual() = 'admin'
  or (
    public.rol_actual() = 'agente'
    and (
      asignado_a = auth.uid()
      or asignado_a is null
      or exists (
        select 1 from ticket_asignados ta
        where ta.ticket_id = tickets.id and ta.profile_id = auth.uid()
      )
    )
  )
);

drop policy ticket_status_history_select on ticket_status_history;

create policy ticket_status_history_select on ticket_status_history for select to authenticated using (
  exists (
    select 1 from tickets t
    where t.id = ticket_id
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
  )
);
