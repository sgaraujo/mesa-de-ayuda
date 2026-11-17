-- Las solicitudes operativas se centralizan en el área Operación.
--
-- · areas.recibe_solicitudes: false saca el área del paso 1 de
--   /nueva-solicitud (NOC - ETB y Operación SOMOS). El tablero sigue
--   existiendo para sus miembros, con sus tareas; solo deja de recibir
--   solicitudes nuevas de otras personas.
-- · areas.pide_proyecto: el formulario exige elegir el proyecto al que
--   pertenece la solicitud (Operación).
-- · tickets.proyecto_rrhh: ese proyecto, tal como lo nombra la base de
--   Talento Humano (Nelyoda, personas_nelyoda.relaciones[].proyecto). Es
--   texto y no el proyectos.id del área: ese catálogo lo maneja el equipo para
--   organizarse, este identifica la operación para reportes.

alter table areas add column if not exists recibe_solicitudes boolean not null default true;
alter table areas add column if not exists pide_proyecto boolean not null default false;

update areas set recibe_solicitudes = false
where nombre ilike 'NOC%ETB%' or nombre ilike 'Operaci_n SOMOS';

update areas set pide_proyecto = true
where nombre ilike 'Operaci_n';

alter table tickets add column if not exists proyecto_rrhh text;
alter table tickets drop constraint if exists tickets_proyecto_rrhh_check;
alter table tickets add constraint tickets_proyecto_rrhh_check
  check (proyecto_rrhh is null or length(btrim(proyecto_rrhh)) between 1 and 200);

-- Proyectos vigentes según la base de RRHH, con la marca del (o los) de quien
-- consulta para preseleccionarlo. Security definer para no depender de los
-- grants por columna de personas_nelyoda.
create or replace function public.proyectos_rrhh()
returns table (proyecto text, es_mio boolean)
language sql stable security definer set search_path = public
as $$
  select btrim(r->>'proyecto') as proyecto,
         bool_or(pn.email = (select email from profiles where id = auth.uid())) as es_mio
  from personas_nelyoda pn
  cross join lateral jsonb_array_elements(pn.relaciones) r
  where pn.activo
    and public.usuario_activo()
    and nullif(btrim(r->>'proyecto'), '') is not null
  group by 1
  order by 1;
$$;

revoke all on function public.proyectos_rrhh() from public, anon;
grant execute on function public.proyectos_rrhh() to authenticated;

-- Quien envía una solicitud a un área que pide proyecto, sin ser de esa área,
-- debe indicarlo. No aplica a lo que crea la base sola (recurrencias,
-- reuniones de Teams: auth.uid() nulo) ni al equipo desde su tablero.
create or replace function public.exigir_proyecto_rrhh()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null
     and new.proyecto_rrhh is null
     and public.rol_en_area(new.area_id) is null
     and not public.es_superadmin()
     and exists (select 1 from areas a where a.id = new.area_id and a.pide_proyecto) then
    raise exception 'Indica el proyecto al que pertenece la solicitud.';
  end if;
  return new;
end;
$$;

drop trigger if exists exigir_proyecto_rrhh on tickets;
create trigger exigir_proyecto_rrhh
  before insert on tickets
  for each row execute function public.exigir_proyecto_rrhh();
