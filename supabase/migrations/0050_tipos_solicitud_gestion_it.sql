-- Tipos de solicitud de Gestión IT (catálogo por área de 0031): con esto el
-- formulario de Nueva solicitud le pide elegir uno al enviarle una solicitud
-- a esa área. Lista enviada por el equipo de Gestión IT.

insert into tipos_solicitud (area_id, nombre, orden)
select a.id, t.nombre, t.orden
from areas a
cross join (values
  ('Acuerdo de Compra', 1),
  ('Asignación Equipos IT', 2),
  ('Acceso y Autenticación', 3),
  ('Archivos y Almacenamiento', 4),
  ('Backup de la Información', 5),
  ('Boletín Informativo', 6),
  ('Correo Corporativo', 7),
  ('Documentación', 8),
  ('Equipos de Cómputo', 9),
  ('Firmas Corporativas', 10),
  ('Impresora y Periféricos', 11),
  ('Licenciamiento', 12),
  ('Mantenimiento Preventivo', 13),
  ('Permisos y Accesos', 14),
  ('RaEEs', 15),
  ('Redes y Conectividad', 16),
  ('Reporte de Pérdidas o Hurtos', 17),
  ('Retiro de Personal', 18),
  ('Servicios en la Nube', 19),
  ('Servidores', 20),
  ('Software y Aplicaciones', 21),
  ('Soporte Técnico', 22),
  ('Telefonía y Comunicaciones', 23),
  ('Usuarios y Cuentas', 24)
) as t(nombre, orden)
where a.nombre = 'Gestión IT'
on conflict (area_id, nombre) do nothing;
