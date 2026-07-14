-- Publica los cambios del tablero para que los clientes conectados puedan
-- refrescar tickets y miembros de tareas grupales sin recargar la página.
do $$
begin
  alter publication supabase_realtime add table public.tickets;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.ticket_asignados;
exception
  when duplicate_object then null;
end $$;
