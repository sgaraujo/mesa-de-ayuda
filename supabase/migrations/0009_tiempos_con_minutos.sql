-- Permite almacenar minutos sin perder precisión al convertirlos a horas.
alter table tickets
  alter column tiempo_propuesto_horas type numeric(8, 4),
  alter column tiempo_ejecutado_horas type numeric(8, 4);
