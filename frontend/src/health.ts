// Tipos y textos compartidos del análisis (línea base, signos vitales, chequeo diario).
import { t } from './i18n'

export type Level = 'calibrating' | 'normal' | 'unreliable' | 'observe' | 'alert'

export type SignalBaseline = {
  label: string; unit: string; level: Level; n: number
  center: number | null; sd: number | null; low: number | null; high: number | null
  current: number | null; z: number | null; delta: number | null; message: string
}

export type Baseline = {
  source: 'simulation' | 'hardware' | null; window_s: number; method?: string; level: Level
  signals: Partial<Record<'heart_rate_bpm' | 'respiration_rate_bpm', SignalBaseline>>
}

export type VitalsItem = {
  ts: number; source: 'simulation' | 'manual' | 'hardware'
  systolic_mmhg: number | null; diastolic_mmhg: number | null; temperature_c: number | null
  bp_label: string | null; temp_label: string | null
}

export type Vitals = { interval_min: number; next_ts: number; latest_bp: VitalsItem | null; latest_temp: VitalsItem | null; items: VitalsItem[] }

export type Checkin = {
  astronaut_id: string; created_at: string
  sleep_hours: number | null; mood: number | null; stress: number | null; glucose_mg_dl: number | null
  systolic_mmhg: number | null; diastolic_mmhg: number | null; temperature_c: number | null; notes: string | null
}

function levels(): Record<Level, { label: string; short: string; tone: string; title: string }> {
  return {
    calibrating: { label: t('Calibrando', 'Calibrating'), short: t('BASE…', 'BASE…'), tone: 'blue', title: t('Calibrando tu línea base', 'Calibrating your baseline') },
    normal: { label: 'Normal', short: 'NORMAL', tone: 'mint', title: t('Dentro de tu normal', 'Within your normal') },
    unreliable: { label: t('Poco confiable', 'Unreliable'), short: t('SEÑAL', 'SIGNAL'), tone: 'gray', title: t('Lectura poco confiable', 'Unreliable reading') },
    observe: { label: t('Observar', 'Observe'), short: t('OBSERVAR', 'OBSERVE'), tone: 'amber', title: t('Cambio que conviene observar', 'A change worth watching') },
    alert: { label: t('Alerta', 'Alert'), short: t('ALERTA', 'ALERT'), tone: 'red', title: t('Cambio importante frente a tu base', 'Significant change from your baseline') },
  }
}

export function levelInfo(level?: Level | null) {
  const all = levels()
  return all[level ?? 'calibrating'] ?? all.calibrating
}

export type Alert = {
  id: string; level: 0 | 1 | 2 | 3; level_title: string; who: string; title: string; reason: string
  actions: string[]; hazard: string; link: 'Wellness' | 'Exercise Coach' | 'EVA' | null; evidence: string[]
}

export type Report = {
  astronaut_id: string; generated_ts: number; trigger: string; priority: string; max_level: number
  data_source: { ecg: string | null; vitals: string | null; checkin: string | null }
  summary: Partial<Record<'heart_rate_bpm' | 'respiration_rate_bpm', { base: number | null; now: number | null; level: Level; z: number | null }>>
  vitals: { bp: VitalsItem | null; temp: VitalsItem | null }
  checkin: Checkin | null
  alerts: { level: number; title: string; reason: string }[]
  recommendation: string; size_bytes: number; raw_bytes: number
}
