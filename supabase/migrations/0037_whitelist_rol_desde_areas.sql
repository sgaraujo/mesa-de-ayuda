-- La whitelist mostraba el rol con el que se dio de alta el correo, aunque
-- después se le diera otro en /grupos (area_miembros, que es lo que de verdad
-- da permisos): líderes y agentes aparecían como solicitantes.
--
-- Desde ahora cada cambio en area_miembros recalcula el rol de la persona en
-- allowed_emails: 'lider' si lidera alguna área, 'agente' si solo es agente,
-- 'solicitante' si ya no está en ninguna; y como área, la del rol más alto.
-- El trigger de allowed_emails (sincronizar_whitelist_con_perfil) lo lleva a
-- profiles y reescribe esa misma membresía. Los superadmins no se tocan.
--
-- profiles_proteger_columnas (0022) solo deja cambiar profiles.role al
-- superadmin; un líder que agrega a alguien en /grupos no lo es, así que esta
-- sincronización lo autoriza con una marca de transacción
-- (app.sincronizando_rol_area), igual que app.respondiendo_finalizacion en 0032.

create or replace function public.sincronizar_rol_whitelist(p_profile_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_rol_perfil text;
  v_rol text;
  v_area uuid;
begin
  -- Al actualizar allowed_emails, su trigger (sincronizar_whitelist_con_perfil)
  -- vuelve a escribir la membresía en area_miembros, lo que dispararía esta
  -- función otra vez sin fin. La marca corta esa llamada anidada.
  if current_setting('app.sincronizando_rol_area', true) = '1' then
    return;
  end if;

  select email, role into v_email, v_rol_perfil from profiles where id = p_profile_id;
  if v_email is null or v_rol_perfil = 'admin' then
    return;
  end if;

  select am.rol, am.area_id into v_rol, v_area
  from area_miembros am
  join areas a on a.id = am.area_id
  where am.profile_id = p_profile_id
  order by (am.rol = 'lider') desc, a.orden, a.nombre
  limit 1;

  perform set_config('app.sincronizando_rol_area', '1', true);
  update allowed_emails
  set role = coalesce(v_rol, 'solicitante'),
      area_id = v_area
  where lower(trim(email)) = lower(trim(v_email))
    and role <> 'admin'
    and (role is distinct from coalesce(v_rol, 'solicitante') or area_id is distinct from v_area);
  perform set_config('app.sincronizando_rol_area', '', true);
end;
$$;

revoke all on function public.sincronizar_rol_whitelist(uuid) from public, anon, authenticated;

create or replace function public.area_miembros_sincronizar_whitelist()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.sincronizar_rol_whitelist(old.profile_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.profile_id is distinct from old.profile_id) then
    perform public.sincronizar_rol_whitelist(new.profile_id);
  end if;
  return null;
end;
$$;

drop trigger if exists area_miembros_sincronizar_whitelist on area_miembros;
create trigger area_miembros_sincronizar_whitelist
  after insert or update or delete on area_miembros
  for each row execute function public.area_miembros_sincronizar_whitelist();

-- Igual que en 0022, pero deja pasar el cambio de rol que hace la
-- sincronización de arriba (nunca hacia o desde superadmin, nunca el estado).
create or replace function public.proteger_columnas_perfil()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (new.role is distinct from old.role or new.activo is distinct from old.activo)
     and auth.uid() is not null
     and not public.es_superadmin()
     and not (
       current_setting('app.sincronizando_rol_area', true) = '1'
       and new.activo is not distinct from old.activo
       and old.role <> 'admin'
       and new.role <> 'admin'
     ) then
    raise exception 'Solo un administrador puede cambiar el rol o el estado de una cuenta'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Corrige a quienes hoy no coinciden: miembros de algún área y quienes la
-- whitelist marca como líder o agente sin serlo en ninguna.
select public.sincronizar_rol_whitelist(p.id)
from profiles p
where p.role <> 'admin'
  and (
    exists (select 1 from area_miembros am where am.profile_id = p.id)
    or exists (
      select 1 from allowed_emails w
      where lower(trim(w.email)) = lower(trim(p.email)) and w.role in ('lider', 'agente')
    )
  );
