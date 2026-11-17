-- Catálogo de proyectos de RRHH para el formulario de solicitudes.
--
-- En la 0053, proyectos_rrhh() abría en cada llamado el JSON de relaciones
-- laborales de todas las personas de Nelyoda (empresa, área, cargo, jefe,
-- cuenta analítica) solo para sacar el nombre del proyecto, y devolvía cada
-- variante de escritura como un proyecto distinto ("SOMOS", "Somos ",
-- "Operación ETB" / "Operacion ETB").
--
-- Ahora:
--   · proyectos_rrhh guarda solo lo necesario: el nombre y cuántas personas
--     vigentes tiene. Se recalcula sola cada vez que la sincronización de
--     Nelyoda escribe en personas_nelyoda (trigger por sentencia: un lote de
--     hasta 100 personas = un recálculo).
--   · Las variantes se unen por una clave sin tildes, mayúsculas ni espacios
--     repetidos; se muestra la escritura más usada.
--   · proyectos_rrhh() (misma firma que en la 0053, el cliente no cambia)
--     lee el catálogo y, para "es_mio", solo la fila de quien consulta.

create table if not exists proyectos_rrhh (
  clave text primary key,
  nombre text not null,
  personas int not null,
  actualizado_at timestamptz not null default now()
);

alter table proyectos_rrhh enable row level security;

-- Solo lectura para usuarios activos; lo escribe únicamente el trigger.
drop policy if exists proyectos_rrhh_select on proyectos_rrhh;
create policy proyectos_rrhh_select on proyectos_rrhh for select to authenticated
  using (public.usuario_activo());
revoke all on proyectos_rrhh from anon, authenticated;
grant select (nombre, personas) on proyectos_rrhh to authenticated;

create or replace function public.clave_proyecto_rrhh(p_nombre text)
returns text language sql immutable
as $$
  select nullif(
    lower(translate(
      regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g'),
      'ÁÉÍÓÚÜÑáéíóúüñ',
      'AEIOUUNaeiouun'
    )),
    ''
  );
$$;

create or replace function public.recalcular_proyectos_rrhh()
returns void language plpgsql security definer set search_path = public
as $$
begin
  with relaciones as (
    -- Una persona cuenta una vez por proyecto aunque tenga varias relaciones en él.
    select distinct pn.ref,
           public.clave_proyecto_rrhh(r->>'proyecto') as clave,
           regexp_replace(btrim(r->>'proyecto'), '\s+', ' ', 'g') as nombre
    from personas_nelyoda pn
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(pn.relaciones) = 'array' then pn.relaciones else '[]'::jsonb end
    ) r
    where pn.activo
  ),
  catalogo as (
    select clave,
           mode() within group (order by nombre) as nombre,
           count(distinct ref)::int as personas
    from relaciones
    where clave is not null
    group by clave
  ),
  borrados as (
    delete from proyectos_rrhh p
    where not exists (select 1 from catalogo c where c.clave = p.clave)
  )
  insert into proyectos_rrhh (clave, nombre, personas, actualizado_at)
  select clave, nombre, personas, now() from catalogo
  on conflict (clave) do update
    set nombre = excluded.nombre,
        personas = excluded.personas,
        actualizado_at = now()
    where proyectos_rrhh.nombre is distinct from excluded.nombre
       or proyectos_rrhh.personas is distinct from excluded.personas;
end;
$$;

revoke all on function public.recalcular_proyectos_rrhh() from public, anon, authenticated;

create or replace function public.trigger_recalcular_proyectos_rrhh()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.recalcular_proyectos_rrhh();
  return null;
end;
$$;

drop trigger if exists recalcular_proyectos_rrhh on personas_nelyoda;
create trigger recalcular_proyectos_rrhh
  after insert or update or delete on personas_nelyoda
  for each statement execute function public.trigger_recalcular_proyectos_rrhh();

-- Carga inicial con lo que ya está sincronizado.
select public.recalcular_proyectos_rrhh();

-- Misma firma que en la 0053. es_mio sale solo de la fila de quien consulta.
create or replace function public.proyectos_rrhh()
returns table (proyecto text, es_mio boolean)
language sql stable security definer set search_path = public
as $$
  with mios as (
    select distinct public.clave_proyecto_rrhh(r->>'proyecto') as clave
    from personas_nelyoda pn
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(pn.relaciones) = 'array' then pn.relaciones else '[]'::jsonb end
    ) r
    where pn.activo
      and pn.email = (select email from profiles where id = auth.uid())
  )
  select p.nombre, exists (select 1 from mios m where m.clave = p.clave)
  from proyectos_rrhh p
  where public.usuario_activo()
  order by p.nombre;
$$;

revoke all on function public.proyectos_rrhh() from public, anon;
grant execute on function public.proyectos_rrhh() to authenticated;
