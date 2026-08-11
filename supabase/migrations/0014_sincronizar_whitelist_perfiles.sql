-- Mantiene el rol y el area del perfil sincronizados con la whitelist.
-- Una cuenta revocada no se reactiva automaticamente al volver a agregarla.

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

  select id into perfil_id
  from public.profiles
  where lower(trim(email)) = new.email
  limit 1;

  if perfil_id is not null then
    update public.profiles
    set role = new.role,
        area_id = new.area_id
    where id = perfil_id;

    new.used_at := coalesce(new.used_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists allowed_emails_sincronizar_perfil on public.allowed_emails;

create trigger allowed_emails_sincronizar_perfil
  before insert or update of email, role, area_id
  on public.allowed_emails
  for each row execute procedure public.sincronizar_whitelist_con_perfil();

-- Usa una comparacion normalizada cuando Auth crea el perfil. Esto evita que
-- diferencias de mayusculas o espacios hagan caer el rol a "solicitante".
create or replace function public.crear_perfil_desde_whitelist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  whitelist_row public.allowed_emails%rowtype;
  correo_normalizado text;
  dominio text;
  nombre_empresa text;
begin
  correo_normalizado := lower(trim(new.email));

  select * into whitelist_row
  from public.allowed_emails
  where lower(trim(email)) = correo_normalizado
  limit 1;

  dominio := split_part(correo_normalizado, '@', 2);
  nombre_empresa := case dominio
    when 'inteegra.net.co' then 'Inteegra'
    when 'triangulum.net.co' then 'Triangulum'
    when 'netcol.net.co' then 'Netcol'
    else dominio
  end;

  insert into public.profiles (id, email, area_id, role, empresa)
  values (
    new.id,
    correo_normalizado,
    whitelist_row.area_id,
    coalesce(whitelist_row.role, 'solicitante'),
    nombre_empresa
  );

  update public.allowed_emails
  set used_at = now()
  where lower(trim(email)) = correo_normalizado;

  return new;
end;
$$;

-- Repara perfiles existentes cuyo rol o area no coincida con la whitelist.
update public.profiles as perfil
set role = whitelist.role,
    area_id = whitelist.area_id
from public.allowed_emails as whitelist
where lower(trim(perfil.email)) = lower(trim(whitelist.email))
  and (
    perfil.role is distinct from whitelist.role
    or perfil.area_id is distinct from whitelist.area_id
  );

-- Si el perfil ya existe, la persona ya completo el registro aunque el campo
-- used_at haya quedado vacio por una inconsistencia anterior.
update public.allowed_emails as whitelist
set used_at = coalesce(whitelist.used_at, perfil.created_at, now())
from public.profiles as perfil
where lower(trim(perfil.email)) = lower(trim(whitelist.email))
  and whitelist.used_at is null;
