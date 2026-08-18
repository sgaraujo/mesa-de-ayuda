-- Permite que un admin elimine tickets. ticket_status_history y
-- ticket_asignados ya tienen "on delete cascade" hacia tickets, así que no
-- hace falta borrarlos aparte.
create policy tickets_delete_admin on tickets for delete to authenticated
  using (public.rol_actual() = 'admin');
