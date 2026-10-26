-- Varios archivos al crear una solicitud.
--
-- Antes la creación admitía un solo adjunto (tickets.archivo_url, que sigue
-- para las solicitudes viejas). Ahora el cliente crea la tarea, sube los
-- archivos al bucket 'ticket-imagenes' bajo solicitudes/<ticket_id>/ y los
-- registra con adjuntar_archivos_solicitud() en ticket_archivos, sin
-- comentario asociado. Igual que en 0029, no hay policies de escritura.

create or replace function public.adjuntar_archivos_solicitud(p_ticket_id uuid, p_archivos jsonb)
returns void language plpgsql security definer set search_path = public
as $$
declare
  t tickets%rowtype;
  archivos jsonb := coalesce(p_archivos, '[]');
  archivo jsonb;
  ruta text;
  nombre text;
begin
  select * into t from tickets where id = p_ticket_id;
  if not found or t.solicitante_id <> auth.uid() or not public.usuario_activo() then
    raise exception 'Solo quien creó la solicitud puede adjuntar sus archivos' using errcode = '42501';
  end if;

  -- Solo una vez, al crearla: después los archivos van en los comentarios.
  if exists (select 1 from ticket_archivos where ticket_id = p_ticket_id and comentario_id is null) then
    raise exception 'Esta solicitud ya tiene sus archivos de creación' using errcode = '22023';
  end if;

  if jsonb_typeof(archivos) <> 'array' or jsonb_array_length(archivos) = 0 or jsonb_array_length(archivos) > 10 then
    raise exception 'Se pueden adjuntar entre 1 y 10 archivos' using errcode = '22023';
  end if;

  -- La misma lista de extensiones que el formulario (TicketForm).
  for archivo in select * from jsonb_array_elements(archivos) loop
    ruta := archivo->>'ruta';
    nombre := trim(archivo->>'nombre');
    if ruta is null or ruta not like 'solicitudes/' || p_ticket_id::text || '/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'ticket-imagenes' and o.name = ruta) then
      raise exception 'Archivo no válido: %', coalesce(nombre, ruta) using errcode = '22023';
    end if;
    if coalesce(lower(substring(nombre from '\.([^.]+)$')), '') not in (
      'png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip'
    ) then
      raise exception 'Tipo de archivo no permitido: %', nombre using errcode = '22023';
    end if;
  end loop;

  insert into ticket_archivos (ticket_id, comentario_id, subido_por, ruta, nombre, tamano, tipo)
  select p_ticket_id, null, auth.uid(), a->>'ruta', trim(a->>'nombre'), (a->>'tamano')::bigint, nullif(a->>'tipo', '')
  from jsonb_array_elements(archivos) a;
end;
$$;

revoke all on function public.adjuntar_archivos_solicitud(uuid, jsonb) from public, anon;
grant execute on function public.adjuntar_archivos_solicitud(uuid, jsonb) to authenticated;
