-- El líder de un área administra su catálogo de tipos de solicitud (0031)
-- desde /grupos: agrega, renombra, ordena y desactiva. El superadmin, en
-- todas las áreas. Hasta ahora el catálogo solo se cambiaba por SQL.
--
-- No se borran: desactivar quita el tipo del formulario y las tareas que ya
-- lo tienen lo conservan (historial y estadísticas). Por eso no hay policy de
-- delete, y un tipo no se puede pasar a otra área (solo se actualizan
-- nombre, orden y activo).

create or replace function public.puedo_editar_tipos_area(p_area_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.usuario_activo()
    and (public.es_superadmin() or coalesce(public.rol_en_area(p_area_id) = 'lider', false));
$$;

drop policy if exists tipos_solicitud_insert on tipos_solicitud;
create policy tipos_solicitud_insert on tipos_solicitud for insert to authenticated
  with check (public.puedo_editar_tipos_area(area_id));

drop policy if exists tipos_solicitud_update on tipos_solicitud;
create policy tipos_solicitud_update on tipos_solicitud for update to authenticated
  using (public.puedo_editar_tipos_area(area_id))
  with check (public.puedo_editar_tipos_area(area_id));

revoke update on tipos_solicitud from authenticated;
grant update (nombre, orden, activo) on tipos_solicitud to authenticated;

-- Sin espacios sobrantes, para que "Soporte" y "Soporte " no queden como
-- dos tipos distintos.
create or replace function public.normalizar_tipo_solicitud()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.nombre := trim(new.nombre);
  return new;
end;
$$;

drop trigger if exists tipos_solicitud_normalizar on tipos_solicitud;
create trigger tipos_solicitud_normalizar
  before insert or update of nombre on tipos_solicitud
  for each row execute procedure public.normalizar_tipo_solicitud();
