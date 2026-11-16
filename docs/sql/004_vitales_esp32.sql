-- STELLAR Health · temperatura y presión arterial enviadas por el ESP32.
-- Ejecutar UNA vez en Supabase > SQL Editor.
--
-- El firmware de Ricardo (opcionfinal.ino) ya envía estos 3 campos en cada fila.
-- Supabase RECHAZA la fila completa si trae una columna que no existe, así que sin
-- esto el ESP32 deja de guardar datos. Las columnas son opcionales (pueden quedar
-- vacías) y los nombres son EXACTAMENTE los que usa el firmware.

alter table public.telemetry
  add column if not exists temperature_c double precision
    check (temperature_c is null or temperature_c between 30 and 45),
  add column if not exists blood_pressure_systolic_mmhg double precision
    check (blood_pressure_systolic_mmhg is null or blood_pressure_systolic_mmhg between 60 and 250),
  add column if not exists blood_pressure_diastolic_mmhg double precision
    check (blood_pressure_diastolic_mmhg is null or blood_pressure_diastolic_mmhg between 30 and 150);

-- Para que la API de Supabase vea las columnas nuevas de inmediato:
notify pgrst, 'reload schema';
