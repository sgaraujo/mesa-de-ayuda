-- Archivos adjuntos en los comentarios de una tarea.
--
-- El cliente sube cada archivo al bucket 'ticket-imagenes' (0011) bajo
-- comentarios/<ticket_id>/ y después llama a comentar_ticket() con la lista;
-- la función registra el comentario, sus archivos y sus menciones en una sola
-- operación. Igual que los comentarios, los archivos no se editan ni se borran
-- (trazabilidad) y no hay policies de escritura: solo se crean por la RPC.
--
-- El adjunto que se carga al crear la tarea sigue en tickets.archivo_url; la
-- sección "Archivos" del detalle lo muestra junto a los de esta tabla.

create table if not exists ticket_archivos (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  comentario_id uuid references ticket_comentarios(id) on delete cascade,
  subido_por uuid references profiles(id) on delete set null default auth.uid(),
  -- Ruta dentro del bucket; la URL de descarga se arma en el cliente.
  ruta text not null unique,
  nombre text not null check (length(trim(nombre)) > 0 and length(nombre) <= 255),
  tamano bigint not null check (tamano > 0),
  tipo text,
  created_at timestamptz not null default now()
);

create index if not exists ticket_archivos_ticket_idx on ticket_archivos(ticket_id, created_at);
create index if not exists ticket_archivos_comentario_idx on ticket_archivos(comentario_id);

alter table ticket_archivos enable row level security;

drop policy if exists ticket_archivos_select on ticket_archivos;
create policy ticket_archivos_select on ticket_archivos for select to authenticated using (
  public.puedo_ver_ticket(ticket_id)
);

-- Un comentario puede llevar solo archivos, sin texto.
alter table ticket_comentarios drop constraint if exists ticket_comentarios_texto_check;
alter table ticket_comentarios add constraint ticket_comentarios_texto_check check (length(texto) <= 5000);

-- Se reemplaza la versión de 0025 (3 parámetros) por una con p_archivos
-- opcional; dejar ambas haría ambigua la llamada de 3 argumentos en PostgREST.
-- p_archivos: [{ "ruta": "...", "nombre": "...", "tamano": 123, "tipo": "..." }]
drop function if exists public.comentar_ticket(uuid, text, uuid[]);

create or replace function public.comentar_ticket(
  p_ticket_id uuid,
  p_texto text,
  p_mencionados uuid[],
  p_archivos jsonb default '[]'
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  nuevo_id uuid;
  archivos jsonb := coalesce(p_archivos, '[]');
  archivo jsonb;
  ruta text;
  nombre text;
  nombres text;
begin
  if not public.puedo_ver_ticket(p_ticket_id) then
    raise exception 'No puedes comentar en esta tarea' using errcode = '42501';
  end if;

  if jsonb_typeof(archivos) <> 'array' or jsonb_array_length(archivos) > 10 then
    raise exception 'Se pueden adjuntar hasta 10 archivos por comentario' using errcode = '22023';
  end if;

  if length(trim(coalesce(p_texto, ''))) = 0 and jsonb_array_length(archivos) = 0 then
    raise exception 'El comentario está vacío' using errcode = '22023';
  end if;

  -- Cada archivo debe estar ya subido, en la carpeta de esta tarea y con una
  -- extensión permitida.
  for archivo in select * from jsonb_array_elements(archivos) loop
    ruta := archivo->>'ruta';
    nombre := trim(archivo->>'nombre');
    if ruta is null or ruta not like 'comentarios/' || p_ticket_id::text || '/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'ticket-imagenes' and o.name = ruta) then
      raise exception 'Archivo no válido: %', coalesce(nombre, ruta) using errcode = '22023';
    end if;
    if coalesce(lower(substring(nombre from '\.([^.]+)$')), '') not in ('doc', 'docx', 'xls', 'xlsx', 'pdf', 'jpg', 'jpeg', 'png', 'zip') then
      raise exception 'Tipo de archivo no permitido: %', nombre using errcode = '22023';
    end if;
  end loop;

  insert into ticket_comentarios (ticket_id, autor_id, texto)
  values (p_ticket_id, auth.uid(), trim(coalesce(p_texto, '')))
  returning id into nuevo_id;

  insert into ticket_archivos (ticket_id, comentario_id, subido_por, ruta, nombre, tamano, tipo)
  select p_ticket_id, nuevo_id, auth.uid(), a->>'ruta', trim(a->>'nombre'), (a->>'tamano')::bigint, nullif(a->>'tipo', '')
  from jsonb_array_elements(archivos) a;

  insert into ticket_menciones (comentario_id, ticket_id, profile_id)
  select nuevo_id, p_ticket_id, p.id
  from profiles p
  where p.id = any(coalesce(p_mencionados, '{}'))
    and p.activo
    and p.id <> auth.uid()
  on conflict do nothing;

  -- Los triggers de 0026 toman el extracto del texto; si el comentario es
  -- solo de archivos, el aviso dice qué se adjuntó.
  if length(trim(coalesce(p_texto, ''))) = 0 then
    select string_agg(trim(a->>'nombre'), ', ') into nombres from jsonb_array_elements(archivos) a;
    update notificaciones
    set detalle = left('Adjuntó: ' || nombres, 280)
    where comentario_id = nuevo_id;
  end if;

  return nuevo_id;
end;
$$;

revoke all on function public.comentar_ticket(uuid, text, uuid[], jsonb) from public, anon;
grant execute on function public.comentar_ticket(uuid, text, uuid[], jsonb) to authenticated;
