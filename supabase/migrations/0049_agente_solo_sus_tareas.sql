-- Un agente solo ve sus tareas y la bandeja general.
--
-- Las tareas en grupo (0006) guardan a sus responsables en ticket_asignados y
-- dejan asignado_a en null, así que la condición "asignado_a is null" de la
-- bandeja dejaba ver a cualquier agente del área todas las tareas grupales,
-- aunque no estuviera en ellas. La bandeja son solo las individuales sin
-- asignar; de las grupales, el agente ve aquellas en las que está.

-- Igual que en 0043, con la bandeja limitada a las tareas individuales.
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
            t.asignado_a = auth.uid()
            or (t.asignado_a is null and not t.es_grupal)
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
        or (asignado_a is null and not es_grupal)
        or exists (select 1 from ticket_asignados ta where ta.ticket_id = tickets.id and ta.profile_id = auth.uid())
      )
    )
    or public.fui_mencionado(id)
    or public.tengo_subtarea(id)
  )
);
