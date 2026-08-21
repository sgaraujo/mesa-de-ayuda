-- Nota opcional que agente/admin dejan al finalizar una tarea, visible para
-- el solicitante y enviada en el correo de aviso de finalización.
alter table public.tickets
  add column nota_finalizacion text;

alter table public.ticket_email_notifications
  drop constraint ticket_email_notifications_notification_type_check;

alter table public.ticket_email_notifications
  add constraint ticket_email_notifications_notification_type_check
  check (notification_type in ('nueva', 'asignacion', 'finalizado'));
