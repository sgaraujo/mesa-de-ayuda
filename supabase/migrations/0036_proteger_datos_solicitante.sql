-- "Para cuándo" (fecha_requerida) y el tipo de solicitud (tipo_id, p. ej. en
-- Talento Humano) son datos que pone quien pide la tarea: una vez definidos,
-- solo esa persona puede cambiarlos. Si los dejó vacíos, el equipo del área
-- puede completarlos.
--
-- Excepción: al mover la tarea de área (cambiar_area_ticket) el tipo se
-- limpia porque pertenece al área anterior.

create or replace function public.proteger_datos_solicitante()
returns trigger language plpgsql set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() = old.solicitante_id then
    return new;
  end if;

  if old.fecha_requerida is not null and new.fecha_requerida is distinct from old.fecha_requerida then
    raise exception 'La fecha la definió quien hizo la solicitud y solo esa persona puede cambiarla'
      using errcode = '42501';
  end if;

  if old.tipo_id is not null
     and new.tipo_id is distinct from old.tipo_id
     and new.area_id is not distinct from old.area_id then
    raise exception 'El tipo lo definió quien hizo la solicitud y solo esa persona puede cambiarlo'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists tickets_proteger_datos_solicitante on tickets;
create trigger tickets_proteger_datos_solicitante
  before update of fecha_requerida, tipo_id on tickets
  for each row execute function public.proteger_datos_solicitante();
