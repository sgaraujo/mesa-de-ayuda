-- Permite adjuntar una imagen (opcional) al crear una solicitud.
alter table tickets add column imagen_url text;

insert into storage.buckets (id, name, public)
values ('ticket-imagenes', 'ticket-imagenes', true)
on conflict (id) do nothing;

create policy ticket_imagenes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-imagenes');

create policy ticket_imagenes_select on storage.objects for select to public
  using (bucket_id = 'ticket-imagenes');
