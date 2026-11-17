-- Preferencia de correo por persona (página /configuracion).
-- Con recibir_correos = false las Edge Functions de aviso (notify-assignment,
-- notify-mention, notify-finalizacion, notify-vencimientos) no le envían
-- correos de la actividad de sus tareas. La campanita de la app sigue igual,
-- y los correos de cuenta (invitación, contraseña, cambio de correo) se
-- envían siempre.
--
-- Cada persona la cambia en su propio perfil (profiles_update_propio); el
-- trigger proteger_columnas_perfil solo protege role y activo.

alter table public.profiles
  add column if not exists recibir_correos boolean not null default true;

comment on column public.profiles.recibir_correos is
  'Si es false, no se le envían correos de notificaciones de actividad (asignaciones, menciones, finalizaciones, vencimientos).';
