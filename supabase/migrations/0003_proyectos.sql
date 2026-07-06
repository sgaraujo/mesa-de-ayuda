-- Proyectos: lista administrada (como áreas) que el equipo asigna a cada
-- ticket desde el panel de detalle, no en el formulario de solicitud.

create table proyectos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique
);

alter table tickets
  add column proyecto_id uuid references proyectos(id);

alter table proyectos enable row level security;

create policy proyectos_select on proyectos for select to authenticated using (true);

create policy proyectos_agentes_admin_write on proyectos for all to authenticated
  using (public.rol_actual() in ('agente', 'admin'))
  with check (public.rol_actual() in ('agente', 'admin'));
