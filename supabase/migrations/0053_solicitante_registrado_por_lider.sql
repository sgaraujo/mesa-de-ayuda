-- El líder de Gestión IT registra quién le pidió la tarea.
--
-- Muchas solicitudes de IT llegan por fuera de la app (en persona, por chat o
-- por teléfono) y el líder las crea él mismo desde "+ Nueva tarea". La tarea
-- sigue siendo suya (solicitante_id = quien la crea, como siempre, y la
-- finalización queda aprobada al cerrarla él), pero guarda aparte a quien la
-- pidió:
--   · solicitado_por_id      la persona, si tiene cuenta en la Mesa de Ayuda;
--   · solicitado_por_nombre  su nombre (de la lista o escrito a mano);
--   · solicitado_por_email   su correo, si se eligió de la lista.
--
-- Es solo un registro: a quien la pidió no se le avisa nada. Al cerrarla, el
-- correo de notify-finalizacion le llega únicamente al líder, como constancia.
-- Si tiene cuenta, puede abrir la tarea desde Mis solicitudes.
--
-- Solo el líder de un área con areas.registra_solicitante (hoy Gestión IT)
-- o un superadmin pueden llenarlos, únicamente al crear la tarea; después no
-- cambian.

alter table areas
  add column if not exists registra_solicitante boolean not null default false;

update areas set registra_solicitante = true where nombre = 'Gestión IT';

alter table tickets
  add column if not exists solicitado_por_id uuid references profiles(id) on delete set null,
  add column if not exists solicitado_por_nombre text,
  add column if not exists solicitado_por_email citext;

create index if not exists tickets_solicitado_por_idx
  on tickets(solicitado_por_id) where solicitado_por_id is not null;

create or replace function public.puedo_registrar_solicitante(p_area_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.usuario_activo()
    and (public.es_superadmin() or coalesce(public.rol_en_area(p_area_id) = 'lider', false))
    and exists (select 1 from areas where id = p_area_id and registra_solicitante);
$$;

revoke all on function public.puedo_registrar_solicitante(uuid) from public, anon;
grant execute on function public.puedo_registrar_solicitante(uuid) to authenticated;

create or replace function public.controlar_solicitado_por()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  correo_cuenta text;
begin
  if tg_op = 'UPDATE' then
    new.solicitado_por_id := old.solicitado_por_id;
    new.solicitado_por_nombre := old.solicitado_por_nombre;
    new.solicitado_por_email := old.solicitado_por_email;
    return new;
  end if;

  new.solicitado_por_nombre := nullif(trim(coalesce(new.solicitado_por_nombre, '')), '');
  new.solicitado_por_email := nullif(lower(trim(coalesce(new.solicitado_por_email::text, ''))), '');

  -- La pidió para sí mismo: no hay nada aparte que registrar.
  if new.solicitado_por_id is not null and new.solicitado_por_id = new.solicitante_id then
    new.solicitado_por_id := null;
    new.solicitado_por_nombre := null;
    new.solicitado_por_email := null;
  end if;

  if new.solicitado_por_id is null and new.solicitado_por_nombre is null and new.solicitado_por_email is null then
    return new;
  end if;

  if not public.puedo_registrar_solicitante(new.area_id) then
    raise exception 'Solo el líder del área o un superadmin pueden registrar quién pidió la tarea' using errcode = '42501';
  end if;
  if new.solicitado_por_nombre is null then
    raise exception 'Indica quién pidió la tarea' using errcode = '22023';
  end if;
  if length(new.solicitado_por_nombre) > 200 then
    raise exception 'El nombre de quien pidió la tarea es demasiado largo' using errcode = '22023';
  end if;

  if new.solicitado_por_id is not null then
    select email into correo_cuenta from profiles where id = new.solicitado_por_id and activo;
    if not found then
      raise exception 'La persona elegida no tiene una cuenta activa' using errcode = '22023';
    end if;
    new.solicitado_por_email := coalesce(new.solicitado_por_email, lower(correo_cuenta));
  end if;

  return new;
end;
$$;

drop trigger if exists tickets_controlar_solicitado_por on tickets;
create trigger tickets_controlar_solicitado_por
  before insert or update of solicitado_por_id, solicitado_por_nombre, solicitado_por_email on tickets
  for each row execute procedure public.controlar_solicitado_por();

-- Igual que en 0049, más quien pidió la tarea (solicitado_por_id).
create or replace function public.puedo_ver_ticket(p_ticket_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.usuario_activo() and exists (
    select 1 from tickets t
    where t.id = p_ticket_id
      and (
        public.es_superadmin()
        or t.solicitante_id = auth.uid()
        or t.solicitado_por_id = auth.uid()
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
    or solicitado_por_id = auth.uid()
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
