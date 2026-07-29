-- El rol de un usuario ya registrado vive en profiles.role (allowed_emails.role
-- solo se usa como plantilla al momento del registro). No existía policy que
-- permitiera a un admin editar el perfil de otro usuario, por lo que la edición
-- de rol/área desde /admin/whitelist no tenía ningún efecto una vez el usuario
-- ya se había registrado.

create policy profiles_update_admin on profiles for update to authenticated
  using (public.rol_actual() = 'admin') with check (public.rol_actual() = 'admin');
