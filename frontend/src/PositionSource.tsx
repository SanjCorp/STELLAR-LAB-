import { t } from './i18n'
import { resetPhone, startPhone, stopPhone, usePhone, type PositionPrefer } from './phoneTracker'

export type SensorStatus = 'ok' | 'no_data' | 'no_position' | 'unreliable'

export type Position = {
  source: 'hardware' | 'phone' | 'simulation'; x: number; y: number; z: number; distance_m: number; speed_m_s: number | null
  max_distance_m: number; zone: 'cabina' | 'cerca' | 'atencion' | 'fuera'; safe_m: number; tether_m: number; cabin_m?: number; trail: [number, number, number][]
  prefer?: PositionPrefer; used?: PositionPrefer; fallback?: boolean; steps?: number | null
  sensors?: { mpu: SensorStatus; phone: SensorStatus }
}

export const positionUrl = (astronautId: string, prefer: PositionPrefer, limit = 120) =>
  `/api/position?astronaut_id=${astronautId}&limit=${limit}&prefer=${prefer}`

export function sourceLabel(source?: Position['source']) {
  if (source === 'hardware') return t('ESP32 + MPU6050', 'ESP32 + MPU6050')
  if (source === 'phone') return t('CELULAR · PASOS + BRÚJULA', 'PHONE · STEPS + COMPASS')
  return t('SIMULACIÓN', 'SIMULATION')
}

const statusText = (s?: SensorStatus) => ({
  ok: t('con datos', 'receiving'),
  no_data: t('sin datos', 'no data'),
  no_position: t('sin posición', 'no position'),
  unreliable: t('desbocado (> 40 m)', 'drifting (> 40 m)'),
})[s ?? 'no_data']

/** Por qué se está usando otra fuente distinta de la elegida. */
export function fallbackText(pos: Position | null) {
  if (!pos?.fallback || pos.prefer === 'sim') return null
  const name = (p?: PositionPrefer) => p === 'mpu' ? 'MPU6050' : p === 'phone' ? t('celular', 'phone') : t('simulación', 'simulation')
  const reason = pos.prefer ? statusText(pos.sensors?.[pos.prefer]) : ''
  return t(`${name(pos.prefer)} ${reason} → usando ${name(pos.used)}`, `${name(pos.prefer)} ${reason} → using ${name(pos.used)}`)
}

/** Interruptor MPU6050 / Celular / Simulación (con un punto verde si esa fuente tiene datos). */
export function SourceSwitch({ prefer, onChange, pos, compact = false }: { prefer: PositionPrefer; onChange: (p: PositionPrefer) => void; pos: Position | null; compact?: boolean }) {
  const opts: [PositionPrefer, string][] = [['mpu', compact ? 'MPU' : 'MPU6050'], ['phone', t('Celular', 'Phone')], ['sim', 'Sim']]
  return <div className={`src-switch ${compact ? 'compact' : ''}`} role="radiogroup" aria-label={t('Fuente de posición', 'Position source')}>
    {opts.map(([key, label]) => {
      const st = key === 'sim' ? 'ok' : pos?.sensors?.[key]
      return <button key={key} role="radio" aria-checked={prefer === key} className={prefer === key ? 'on' : ''} onClick={() => onChange(key)}
        title={key === 'sim' ? t('Trayectoria simulada', 'Simulated path') : statusText(st)}>
        <i className={st === 'ok' ? 'ok' : st === 'unreliable' ? 'bad' : ''} />{label}
      </button>
    })}
  </div>
}

const errorText = (e: string) => ({
  https: t('Necesita HTTPS: abre la app desde la página de Vercel en el celular.', 'Needs HTTPS: open the app from the Vercel page on the phone.'),
  unsupported: t('Este navegador no tiene sensores de movimiento.', 'This browser has no motion sensors.'),
  denied: t('Permiso de sensores denegado. Actívalo en el navegador y vuelve a intentar.', 'Motion permission denied. Allow it in the browser and try again.'),
})[e] ?? e

/** Botones para usar ESTE celular como sensor de posición. */
export function PhoneControls({ astronautId, compact = false }: { astronautId: string; compact?: boolean }) {
  const ph = usePhone()
  const mine = ph.active && ph.astronautId === astronautId
  return <div className={`phone-ctl ${compact ? 'compact' : ''}`}>
    {!mine
      ? <button className="primary" onClick={() => startPhone(astronautId)}>{t('Usar sensores de este celular', 'Use this phone’s sensors')}</button>
      : <>
        <button onClick={() => resetPhone()}>{t('Poner en cero aquí', 'Zero here')}</button>
        <button onClick={() => stopPhone()}>{t('Detener', 'Stop')}</button>
        <span className="phone-stat"><b>{ph.steps}</b> {t('pasos', 'steps')} · <span className={ph.walking ? 'walk-on' : ''}>{ph.walking ? t('caminando', 'walking') : t('quieto', 'still')}</span>{ph.ignored > 0 ? ` · ${ph.ignored} ${t('ignorados', 'ignored')}` : ''} · {ph.compass ? `${ph.heading ?? 0}°` : t('sin brújula', 'no compass')} · {ph.lastSentOk === false ? t('sin envío', 'not sending') : ph.lastSentOk ? t('enviando', 'sending') : '…'}</span>
      </>}
    {ph.error && !mine && <small className="phone-err">{errorText(ph.error)}</small>}
    {mine && !ph.motion && <small className="phone-err">{ph.error === 'denied' ? errorText('denied') : t('Esperando el acelerómetro… (en una PC no hay sensor)', 'Waiting for the accelerometer… (a PC has no sensor)')}</small>}
  </div>
}
