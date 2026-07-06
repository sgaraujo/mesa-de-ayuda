-- Agrega fecha/hora solicitada por el requester, y tiempo propuesto/ejecutado
-- que registra el agente asignado.

alter table tickets
  add column fecha_requerida timestamptz,
  add column tiempo_propuesto_horas numeric(6, 2),
  add column tiempo_ejecutado_horas numeric(6, 2);
