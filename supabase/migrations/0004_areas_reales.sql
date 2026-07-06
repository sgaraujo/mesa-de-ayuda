-- Reemplaza las áreas de ejemplo por las áreas reales de la empresa,
-- respetando el orden en que deben aparecer en los desplegables.

alter table areas add column orden int not null default 0;

insert into areas (nombre, orden) values
  ('Contabilidad', 1),
  ('Financiera', 2),
  ('Talento Humano', 3),
  ('Compras', 4),
  ('Comercial', 5),
  ('Sostenibilidad', 6),
  ('Gestión IT', 7),
  ('Área Jurídica', 8),
  ('Dirección General', 9)
on conflict (nombre) do update set orden = excluded.orden;

-- Quita las áreas de ejemplo del scaffold inicial, solo si nadie quedó
-- referenciándolas (tickets, perfiles o whitelist).
delete from areas
where nombre in ('Soporte', 'Infraestructura', 'Desarrollo', 'Administrativo')
  and not exists (select 1 from tickets where tickets.area_id = areas.id)
  and not exists (select 1 from profiles where profiles.area_id = areas.id)
  and not exists (select 1 from allowed_emails where allowed_emails.area_id = areas.id);
