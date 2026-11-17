-- Anuncio de novedades (src/lib/novedades.ts): la app muestra una ventana con
-- lo nuevo después de un despliegue, una sola vez por persona. Aquí se guarda
-- el id de la última novedad que vio, para que no se repita al cambiar de
-- computador o de navegador.
--
-- Cada persona la escribe en su propio perfil (profiles_update_propio); el
-- trigger proteger_columnas_perfil solo protege role y activo.

alter table public.profiles
  add column if not exists novedad_vista text;

comment on column public.profiles.novedad_vista is
  'Id de la última novedad (src/lib/novedades.ts) que la persona ya vio.';
