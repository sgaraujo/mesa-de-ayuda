-- Permite que un admin cree áreas nuevas desde /admin/whitelist. Hasta ahora
-- 'areas' solo tenía policy de select (las áreas se cargaban a mano por SQL).
create policy areas_insert_admin on areas for insert to authenticated
  with check (public.rol_actual() = 'admin');
