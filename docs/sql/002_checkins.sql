-- STELLAR Health · tabla de chequeos diarios (sueño, ánimo, tensión, glucosa, presión, temperatura).
-- Ejecutar UNA vez en Supabase > SQL Editor. No toca la tabla `telemetry` ni lo que envía el ESP32.

create table if not exists public.checkins (
  id             bigint generated always as identity primary key,
  astronaut_id   text not null check (astronaut_id in ('bresnik', 'parmitano', 'douglas', 'rubio')),
  created_at     timestamptz not null default now(),
  sleep_hours    numeric check (sleep_hours between 0 and 24),
  mood           smallint check (mood between 1 and 5),
  stress         smallint check (stress between 1 and 5),
  glucose_mg_dl  numeric check (glucose_mg_dl between 20 and 600),
  systolic_mmhg  numeric check (systolic_mmhg between 60 and 250),
  diastolic_mmhg numeric check (diastolic_mmhg between 30 and 150),
  temperature_c  numeric check (temperature_c between 30 and 45),
  notes          text check (char_length(notes) <= 500)
);

create index if not exists checkins_astronaut_created_idx on public.checkins (astronaut_id, created_at desc);

-- RLS activo y SIN políticas: la clave pública (la del ESP32) no puede leer ni escribir aquí.
-- Solo el backend, con la clave secreta, guarda y lee los chequeos.
alter table public.checkins enable row level security;
