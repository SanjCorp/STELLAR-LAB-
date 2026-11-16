import { useEffect, useState } from 'react'
import type { CrewProfile } from './profiles'
import { apiFetch } from './api'
import { LangSwitch, missionDay, MISSION_START, locale, roleLabel, t } from './i18n'

type Health = { status: string; supabase?: string; checkins?: string; password_required?: boolean; live_window_s?: number }

// Solo ajustes que de verdad hacen algo: idioma + estado real del sistema.
export default function SettingsPanel({ profile }: { profile: CrewProfile }) {
  const nasa = profile.access === 'nasa'
  const [health, setHealth] = useState<Health | null>(null)
  useEffect(() => { apiFetch('/api/health').then(r => r.ok ? r.json() : null).then(setHealth).catch(() => setHealth(null)) }, [])
  const ok = (v?: string) => v === 'ok' ? t('conectado', 'connected') : v === 'disabled' ? t('desactivado', 'disabled') : v === 'missing_table' ? t('falta la tabla', 'table missing') : v ? t('error', 'error') : '—'

  return <section className="settings-page">
    <div className="settings-heading"><span>{nasa ? t('PERFIL TÉCNICO · TIERRA', 'TECHNICAL PROFILE · EARTH') : t('PREFERENCIAS DEL PERFIL', 'PROFILE PREFERENCES')}</span><h2>{nasa ? t('Configuración del sistema', 'System configuration') : t('Mis preferencias', 'My preferences')}</h2><p>{t('Los ajustes se guardan en este navegador.', 'Settings are saved in this browser.')}</p></div>
    <div className="settings-grid">
      <article><span>{t('PERFIL', 'PROFILE')}</span><div className="settings-identity"><div>{profile.initials}</div><h3>{profile.name}</h3><p>{roleLabel(profile.role)} · {profile.agency}</p></div>
        <label>{t('Idioma de la interfaz', 'Interface language')}<LangSwitch /></label>
        <p className="settings-note">{t('Cambia también el idioma de las alertas y de los reportes para Tierra.', 'Also changes the language of alerts and Earth reports.')}</p>
      </article>
      <article><span>{t('MISIÓN', 'MISSION')}</span>
        <dl className="settings-list">
          <div><dt>{t('Misión', 'Mission')}</dt><dd>STELLAR-01</dd></div>
          <div><dt>{t('Inicio', 'Start')}</dt><dd>{new Date(MISSION_START).toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })}</dd></div>
          <div><dt>{t('Día de misión', 'Mission day')}</dt><dd>{missionDay()}</dd></div>
          <div><dt>{t('Unidades', 'Units')}</dt><dd>{t('Métricas (lpm, °C, mmHg, m)', 'Metric (bpm, °C, mmHg, m)')}</dd></div>
        </dl>
      </article>
      <article><span>{t('ESTADO DEL SISTEMA', 'SYSTEM STATUS')}</span>
        <dl className="settings-list">
          <div><dt>API</dt><dd>{health ? t('en línea', 'online') : t('sin conexión', 'offline')}</dd></div>
          <div><dt>{t('Base de datos (telemetría)', 'Database (telemetry)')}</dt><dd>{ok(health?.supabase)}</dd></div>
          <div><dt>{t('Chequeos diarios', 'Daily check-ins')}</dt><dd>{ok(health?.checkins)}</dd></div>
          <div><dt>{t('Contraseña del equipo', 'Team password')}</dt><dd>{health?.password_required ? t('activada', 'enabled') : t('no requerida', 'not required')}</dd></div>
          <div><dt>{t('Paso a simulación', 'Fallback to simulation')}</dt><dd>{health?.live_window_s ? t(`tras ${health.live_window_s} s sin datos del ESP32`, `after ${health.live_window_s} s without ESP32 data`) : '—'}</dd></div>
        </dl>
      </article>
    </div>
  </section>
}
