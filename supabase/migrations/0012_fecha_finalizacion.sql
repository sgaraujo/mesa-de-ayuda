-- Mantiene finalizado_at consistente aunque el estado se cambie desde un
-- cliente distinto al tablero. Las tareas antiguas sin fecha toman updated_at
-- como referencia inicial para poder aplicar el archivo de 30 días.

update tickets
set finalizado_at = updated_at
where estado = 'finalizado' and finalizado_at is null;

create or replace function public.sincronizar_fecha_finalizacion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.estado = 'finalizado' then
    if tg_op = 'INSERT' or old.estado is distinct from 'finalizado' or new.finalizado_at is null then
      new.finalizado_at = now();
    end if;
  else
    new.finalizado_at = null;
  end if;

  return new;
end;
$$;

drop trigger if exists tickets_sincronizar_fecha_finalizacion on tickets;

create trigger tickets_sincronizar_fecha_finalizacion
  before insert or update of estado, finalizado_at on tickets
  for each row execute procedure public.sincronizar_fecha_finalizacion();

create index if not exists tickets_finalizado_at_idx
  on tickets(finalizado_at)
  where estado = 'finalizado';
