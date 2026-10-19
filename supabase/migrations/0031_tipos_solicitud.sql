-- Tipo de solicitud: catálogo por área. Si el área destino tiene tipos, el
-- formulario pide elegir uno; las áreas sin tipos no cambian. Por ahora solo
-- Talento Humano tiene (la misma lista de su mesa de ayuda en Odoo).
--
-- El catálogo se administra por SQL. Cualquier usuario activo puede leerlo:
-- todos pueden enviarle solicitudes a cualquier área.

create table if not exists tipos_solicitud (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references areas(id) on delete cascade,
  nombre text not null check (length(trim(nombre)) > 0),
  orden int not null default 0,
  activo boolean not null default true,
  unique (area_id, nombre)
);

alter table tipos_solicitud enable row level security;

drop policy if exists tipos_solicitud_select on tipos_solicitud;
create policy tipos_solicitud_select on tipos_solicitud for select to authenticated using (
  public.usuario_activo()
);

alter table tickets
  add column if not exists tipo_id uuid references tipos_solicitud(id) on delete set null;

create index if not exists tickets_tipo_id_idx on tickets(tipo_id);

-- El tipo debe ser del área de la tarea.
create or replace function public.validar_tipo_ticket()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.tipo_id is not null
     and not exists (select 1 from tipos_solicitud where id = new.tipo_id and area_id = new.area_id) then
    raise exception 'El tipo de solicitud no corresponde al área de la tarea' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_validar_tipo on tickets;
create trigger tickets_validar_tipo
  before insert or update of tipo_id, area_id on tickets
  for each row execute procedure public.validar_tipo_ticket();

-- Al cambiar de área (0030) el tipo del área anterior ya no aplica.
create or replace function public.cambiar_area_ticket(p_ticket_id uuid, p_area_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare
  t tickets%rowtype;
begin
  if not public.es_superadmin() then
    raise exception 'Solo un administrador puede cambiar el área de una tarea' using errcode = '42501';
  end if;

  select * into t from tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'La tarea no existe' using errcode = 'P0002';
  end if;
  if not exists (select 1 from areas where id = p_area_id) then
    raise exception 'El área no existe' using errcode = 'P0002';
  end if;
  if t.area_id = p_area_id then
    return;
  end if;

  delete from ticket_asignados where ticket_id = p_ticket_id;

  update tickets
  set area_id = p_area_id,
      proyecto_id = null,
      tipo_id = null,
      asignado_a = null,
      es_grupal = false,
      estado = 'pendiente',
      finalizado_at = null
  where id = p_ticket_id;

  if t.estado <> 'pendiente' then
    insert into ticket_status_history (ticket_id, estado, changed_by)
    values (p_ticket_id, 'pendiente', auth.uid());
  end if;
end;
$$;

insert into tipos_solicitud (area_id, nombre, orden)
select a.id, t.nombre, t.orden
from areas a
cross join (values
  ('Acceso portal empleado Odoo (usuario)', 1),
  ('Afiliación Cooperativa Canapro', 2),
  ('Afiliación Fondo Empleados - Corpecol', 3),
  ('Afiliación beneficiarios a la CCF', 4),
  ('Afiliación beneficiarios a la EPS', 5),
  ('Asesoría sobre incapacidad médica / Licencia de Luto / Maternidad / Paternidad', 6),
  ('Asesoría sobre permisos especiales', 7),
  ('Avanzo - solicitud de crédito de emergencia', 8),
  ('Certificado Ingresos y Retenciones', 9),
  ('Certificado laboral especial (con funciones)', 10),
  ('Copia documento de hoja de vida', 11),
  ('Descargos', 12),
  ('Desprendible de pago (portal del empleado)', 13),
  ('Estado de vacaciones', 14),
  ('Funcionalidad plataforma Auco (firma y/o descargue de documentos)', 15),
  ('Hoja de vida (¿dónde enviarla?)', 16),
  ('Inducción Corporativa - Módulo E-Learning', 17),
  ('Información sobre convenio cuentas de nómina', 18),
  ('Nómina - Inquietudes sobre su pago', 19),
  ('Requerimiento interno TH (Exclusivo para miembros de Talento Humano)', 20),
  ('Retiro beneficiario a la CCF', 21),
  ('Retiro parcial de Cesantías', 22),
  ('Otra (NO debe ser novedad para nómina)', 23)
) as t(nombre, orden)
where a.nombre = 'Talento Humano'
on conflict (area_id, nombre) do nothing;
