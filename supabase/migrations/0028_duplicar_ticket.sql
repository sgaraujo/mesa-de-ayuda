-- Duplicar tareas (procesos recurrentes, p. ej. seguimientos semanales): la
-- copia guarda de qué tarea salió para mantener la trazabilidad. Si el
-- original se elimina, la copia sigue existiendo y solo pierde la referencia.
-- La copia se crea desde el cliente con las policies de siempre
-- (tickets_insert, ticket_asignados_write), así que no hace falta ninguna nueva.
alter table tickets
  add column if not exists duplicado_de uuid references tickets(id) on delete set null;

create index if not exists tickets_duplicado_de_idx on tickets(duplicado_de);
