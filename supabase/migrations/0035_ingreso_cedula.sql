-- Ingreso por cédula (Edge Function acceso-cedula): quien no tiene correo
-- corporativo entra con su cédula y un código que le envía Nelyoda.
--
-- Nelyoda limita los códigos por cédula; esta tabla limita las solicitudes por
-- IP para que nadie recorra cédulas al azar. Solo la usa la Edge Function
-- (service role): RLS activo y sin policies.
--
-- Las cuentas creadas así, para personas sin correo corporativo, usan un
-- correo interno @cedula.local que nunca recibe correos (ver _shared/graph.ts).

create table if not exists accesos_cedula (
  id bigint generated always as identity primary key,
  ip text not null,
  created_at timestamptz not null default now()
);

create index if not exists accesos_cedula_ip_fecha on accesos_cedula (ip, created_at desc);

alter table accesos_cedula enable row level security;
revoke all on accesos_cedula from anon, authenticated;
