-- Cambio del correo de una persona (por ejemplo, cuando le cambian el correo
-- corporativo). Lo hace la Edge Function admin-change-email: primero cambia
-- el correo de inicio de sesión en Supabase Auth y luego llama a
-- cambiar_correo_persona() para la whitelist y el perfil.
--
-- El trigger de la whitelist (sincronizar_whitelist_con_perfil) se dispara al
-- cambiar allowed_emails.email y reescribe rol, área y membresía con los
-- valores de la whitelist; eso desharía cambios de rol hechos después desde
-- Grupos. Durante un cambio de correo el trigger solo normaliza el correo.

create or replace function public.sincronizar_whitelist_con_perfil()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  perfil_id uuid;
begin
  new.email := lower(trim(new.email));

  if current_setting('app.solo_cambio_correo', true) = 'on' then
    return new;
  end if;

  select id into perfil_id
  from public.profiles
  where lower(trim(email)) = new.email
  limit 1;

  if perfil_id is not null then
    update public.profiles
    set role = new.role,
        area_id = new.area_id
    where id = perfil_id;

    if new.area_id is not null and new.role in ('lider', 'agente') then
      insert into public.area_miembros (area_id, profile_id, rol)
      values (new.area_id, perfil_id, new.role)
      on conflict (area_id, profile_id) do update set rol = excluded.rol;
    end if;

    new.used_at := coalesce(new.used_at, now());
  end if;

  return new;
end;
$$;

-- Solo la usa la Edge Function (service role), después de validar que quien
-- la pide es superadmin y de cambiar el correo en Auth.
create or replace function public.cambiar_correo_persona(p_actual text, p_nuevo text, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  nuevo text := lower(trim(p_nuevo));
begin
  perform set_config('app.solo_cambio_correo', 'on', true);

  update allowed_emails set email = nuevo where email = lower(trim(p_actual));
  if not found then
    raise exception 'El correo % no está en la whitelist', p_actual using errcode = 'P0002';
  end if;

  if p_profile_id is not null then
    update profiles
    set email = nuevo,
        empresa = case split_part(nuevo, '@', 2)
          when 'inteegra.net.co' then 'Inteegra'
          when 'triangulum.net.co' then 'Triangulum'
          when 'netcol.net.co' then 'Netcol'
          else split_part(nuevo, '@', 2)
        end
    where id = p_profile_id;
  end if;

  perform set_config('app.solo_cambio_correo', 'off', true);
end;
$$;

revoke all on function public.cambiar_correo_persona(text, text, uuid) from public, anon, authenticated;
grant execute on function public.cambiar_correo_persona(text, text, uuid) to service_role;
