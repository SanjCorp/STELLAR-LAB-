-- STELLAR Health · columna Z para la posición 3D (vista "Posición EVA").
-- Ejecutar UNA vez en Supabase > SQL Editor.
-- Es una columna nueva y OPCIONAL (puede quedar vacía): las filas que el ESP32 ya envía
-- siguen funcionando igual. Hasta ejecutar esto, el ESP32 NO debe enviar "pos_z_m"
-- (Supabase rechaza campos que no existen en la tabla).

alter table public.telemetry add column if not exists pos_z_m double precision;
