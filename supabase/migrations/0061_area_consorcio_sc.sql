-- Área (tablero / grupo) "Consorcio SC". Queda al final del orden, recibe
-- solicitudes y no tiene miembros todavía: el superadmin asigna líderes y
-- agentes desde la whitelist o desde /grupos.
insert into areas (nombre, orden)
values ('Consorcio SC', (select coalesce(max(orden), 0) + 1 from areas))
on conflict (nombre) do nothing;
