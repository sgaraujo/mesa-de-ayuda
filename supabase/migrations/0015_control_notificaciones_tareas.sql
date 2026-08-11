-- Evita correos duplicados o abuso del endpoint de notificaciones.
create table public.ticket_email_notifications (
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null check (notification_type in ('nueva', 'asignacion')),
  sent_at timestamptz not null default now(),
  primary key (ticket_id, recipient_id, notification_type)
);

alter table public.ticket_email_notifications enable row level security;

-- No se crean policies: solo las Edge Functions con service_role pueden
-- consultar o modificar este registro interno.
