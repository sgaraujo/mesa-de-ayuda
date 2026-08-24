-- Permite que un admin elimine áreas desde /admin/whitelist. La FK de
-- area_id en tickets/profiles/allowed_emails no tiene "on delete", así que
-- postgres rechaza el delete (23503) si el área sigue en uso; el cliente
-- interpreta ese código para mostrar un mensaje claro en vez del error crudo.
create policy areas_delete_admin on areas for delete to authenticated
  using (public.rol_actual() = 'admin');
