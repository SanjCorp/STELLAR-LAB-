-- STELLAR Health · tasa de dosis de radiacion enviada por el ESP32.
-- Ejecutar UNA vez en Supabase > SQL Editor.
--
-- La unidad almacenada es microsievert por hora (uSv/h). La columna es opcional
-- porque los nodos sin control o sensor de radiacion deben poder enviar telemetria.

alter table public.telemetry
  add column if not exists radiation_dose_rate_usvh double precision
    check (radiation_dose_rate_usvh is null or radiation_dose_rate_usvh >= 0);

-- Fuerza a PostgREST a reconocer la columna inmediatamente.
notify pgrst, 'reload schema';
