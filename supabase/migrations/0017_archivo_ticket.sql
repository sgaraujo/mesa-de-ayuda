-- El adjunto de una solicitud ya no se limita a imágenes (ahora también PDF,
-- Word, Excel, PowerPoint, TXT, CSV y ZIP), así que se renombra la columna.
-- El bucket 'ticket-imagenes' y sus policies no restringen por tipo de
-- archivo, así que no necesitan cambios.
alter table tickets rename column imagen_url to archivo_url;
