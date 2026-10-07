-- Comentarios en las tareas con menciones (@persona).
--
-- Se puede mencionar a cualquier usuario activo, sea o no del área. Quien es
-- mencionado puede ver esa tarea puntual (y comentar en ella) aunque el
-- tablero del área siga cerrado para él; la sigue desde Mis solicitudes.
--
-- Los comentarios no se editan ni se borran (trazabilidad) y se crean solo
-- con comentar_ticket(), que inserta el comentario y sus menciones en una
-- sola operación. El correo lo envía la Edge Function notify-mention, que
-- marca cada mención como notificada para no repetir el aviso.

create table if not exists ticket_comentarios (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  autor_id uuid references profiles(id) on delete set null default auth.uid(),
  texto text not null check (length(trim(texto)) > 0 and length(texto) <= 5000),
  created_at timestamptz not null default now()
);

create index if not exists ticket_comentarios_ticket_idx on ticket_comentarios(ticket_id, created_at);

create table if not exists ticket_menciones (
  comentario_id uuid not null references ticket_comentarios(id) on delete cascade,
  ticket_id uuid not null references tickets(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  notificado_at timestamptz,
  primary key (comentario_id, profile_id)
);

create index if not exists ticket_menciones_persona_idx on ticket_menciones(profile_id, ticket_id);

alter table ticket_comentarios enable row level security;
alter table ticket_menciones enable row level security;

-- Igual que puedo_ver_ticket (0007): security definer para que la policy de
-- tickets pueda mirar ticket_menciones sin re-disparar RLS en bucle.
create or replace function public.fui_mencionado(p_ticket_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from ticket_menciones
    where ticket_id = p_ticket_id and profile_id = auth.uid()
  );
$$;

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
            t.asignado_a = auth.uid() or t.asignado_a is null
            or exists (select 1 from ticket_asignados ta where ta.ticket_id = t.id and ta.profile_id = auth.uid())
          )
        )
        or public.fui_mencionado(t.id)
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
        or asignado_a is null
        or exists (select 1 from ticket_asignados ta where ta.ticket_id = tickets.id and ta.profile_id = auth.uid())
      )
    )
    or public.fui_mencionado(id)
  )
);

drop policy if exists ticket_comentarios_select on ticket_comentarios;
create policy ticket_comentarios_select on ticket_comentarios for select to authenticated using (
  public.puedo_ver_ticket(ticket_id)
);

drop policy if exists ticket_menciones_select on ticket_menciones;
create policy ticket_menciones_select on ticket_menciones for select to authenticated using (
  public.puedo_ver_ticket(ticket_id)
);

-- Sin policies de escritura: solo se comenta por aquí. Las menciones a
-- personas inactivas o a uno mismo se descartan.
create or replace function public.comentar_ticket(p_ticket_id uuid, p_texto text, p_mencionados uuid[])
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  nuevo_id uuid;
begin
  if not public.puedo_ver_ticket(p_ticket_id) then
    raise exception 'No puedes comentar en esta tarea' using errcode = '42501';
  end if;

  insert into ticket_comentarios (ticket_id, autor_id, texto)
  values (p_ticket_id, auth.uid(), trim(p_texto))
  returning id into nuevo_id;

  insert into ticket_menciones (comentario_id, ticket_id, profile_id)
  select nuevo_id, p_ticket_id, p.id
  from profiles p
  where p.id = any(coalesce(p_mencionados, '{}'))
    and p.activo
    and p.id <> auth.uid()
  on conflict do nothing;

  return nuevo_id;
end;
$$;

revoke all on function public.comentar_ticket(uuid, text, uuid[]) from public, anon;
grant execute on function public.comentar_ticket(uuid, text, uuid[]) to authenticated;
