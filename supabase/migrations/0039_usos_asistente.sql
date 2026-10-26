-- Límite de uso del asistente de redacción con IA (Edge Function
-- asistente-solicitud): cada llamada a Gemini se registra por persona para
-- que nadie gaste la cuota de la llave usándolo para otras cosas. Solo la
-- escribe y la lee la función (service role).

create table if not exists usos_asistente (
  id bigint generated always as identity primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists usos_asistente_persona_fecha on usos_asistente (profile_id, created_at desc);

alter table usos_asistente enable row level security;
revoke all on usos_asistente from anon, authenticated;
