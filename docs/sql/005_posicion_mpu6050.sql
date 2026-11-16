-- STELLAR Health · posición del MPU6050 enviada por el ESP32 (firmware opcionfinal v2.0).
-- Ejecutar UNA vez en Supabase > SQL Editor.
--
-- El firmware nuevo de Ricardo envía en cada fila estos 4 campos. Supabase RECHAZA la fila
-- completa si trae una columna que no existe, así que sin esto el ESP32 deja de guardar datos
-- (pulso, respiración, todo). Las columnas son opcionales y los nombres son EXACTAMENTE
-- los del firmware. Incluye pos_z_m (la del archivo 003, que no se había ejecutado).

alter table public.telemetry
  add column if not exists pos_z_m double precision,
  add column if not exists distance_from_origin_m double precision
    check (distance_from_origin_m is null or distance_from_origin_m >= 0),
  add column if not exists movement_detected boolean,
  add column if not exists outside_safe_radius boolean;

-- Para que la API de Supabase vea las columnas nuevas de inmediato:
notify pgrst, 'reload schema';
