import type { Sample } from './charts'
import type { Baseline, Vitals } from './health'
import { missionDay, roleLabel, t } from './i18n'
import type { CrewProfile } from './profiles'

// "Mi perfil": quién soy, qué sensores llevo, cuál es mi normal y quién puede ver mis datos.
export default function CrewProfileView({ profile, sample, baseline, vitals }: { profile: CrewProfile; sample: Sample | null; baseline: Baseline | null; vitals: Vitals | null }) {
  const hw = sample?.source === 'hardware'
  const vitalsHw = vitals?.latest_temp?.source === 'hardware' || vitals?.latest_bp?.source === 'hardware'
  const hr = baseline?.signals?.heart_rate_bpm, rr = baseline?.signals?.respiration_rate_bpm
  const sensors = [
    { name: 'AD8232', what: t('ECG → pulso y respiración (EDR)', 'ECG → heart rate and breathing (EDR)'), state: hw ? t('en vivo', 'live') : t('simulado', 'simulated'), real: hw },
    { name: 'MPU6050', what: t('Acelerómetro + giroscopio → movimiento, postura y posición', 'Accelerometer + gyroscope → movement, posture and position'), state: hw ? t('en vivo', 'live') : t('simulado', 'simulated'), real: hw },
    { name: t('Presión y temperatura', 'Blood pressure and temperature'), what: vitalsHw ? t('Enviadas por el ESP32 (valores de prueba, aún sin sensor)', 'Sent by the ESP32 (test values, no sensor yet)') : t('Sin sensor: medición automática simulada cada 30 min o anotada a mano', 'No sensor: simulated automatic reading every 30 min or entered manually'), state: vitalsHw ? 'ESP32' : t('simulado', 'simulated'), real: vitalsHw },
    { name: t('Chequeo diario', 'Daily check-in'), what: t('Sueño, ánimo, tensión y glucosa', 'Sleep, mood, stress and glucose'), state: 'manual', real: false },
  ]
  const access = profile.access === 'captain'
    ? t('Como comandante ves el estado de toda la tripulación (solo lectura) y los reportes para Tierra.', 'As commander you see the whole crew status (read only) and the Earth reports.')
    : t('Tus datos los ves tú; el comandante ve un resumen de solo lectura y los médicos en Tierra reciben reportes.', 'You see your data; the commander sees a read-only summary and flight surgeons on Earth receive reports.')

  return <section className="profile-page">
    <article className="panel profile-hero" style={{ '--profile-accent': profile.accent } as React.CSSProperties}>
      {profile.photo ? <img src={profile.photo} alt="" /> : <div className="ini">{profile.initials}</div>}
      <div><span>{t('TRIPULANTE', 'CREW MEMBER')} · STELLAR-01</span><h2>{profile.name}</h2><p>{roleLabel(profile.role)} · {profile.agency}</p>
        <div className="profile-chips"><em>{t('Día de misión', 'Mission day')} {missionDay()}</em><em>{t('Nodo', 'Node')} {profile.node ?? '—'}{hw && sample?.device_id ? ` · ${sample.device_id}` : ''}</em><em className={hw ? 'real' : ''}>{hw ? t('ESP32 conectado', 'ESP32 connected') : t('Nodo sin señal · datos simulados', 'Node offline · simulated data')}</em></div></div>
    </article>

    <div className="profile-grid">
      <article className="panel"><span>{t('MI NORMAL (LÍNEA BASE)', 'MY NORMAL (BASELINE)')}</span>
        <dl className="settings-list">
          <div><dt>{t('Pulso en reposo', 'Resting heart rate')}</dt><dd>{hr?.center != null ? `${hr.center} ${hr.unit} (${hr.low?.toFixed(0)}–${hr.high?.toFixed(0)})` : t('calibrando…', 'calibrating…')}</dd></div>
          <div><dt>{t('Respiración', 'Breathing')}</dt><dd>{rr?.center != null ? `${rr.center} ${rr.unit} (${rr.low?.toFixed(0)}–${rr.high?.toFixed(0)})` : t('calibrando…', 'calibrating…')}</dd></div>
          <div><dt>{t('Presión (última)', 'Blood pressure (latest)')}</dt><dd>{vitals?.latest_bp ? `${vitals.latest_bp.systolic_mmhg}/${vitals.latest_bp.diastolic_mmhg} mmHg` : '—'}</dd></div>
          <div><dt>{t('Temperatura (última)', 'Temperature (latest)')}</dt><dd>{vitals?.latest_temp ? `${vitals.latest_temp.temperature_c} °C` : '—'}</dd></div>
        </dl>
        <p className="muted">{t('Se recalcula sola con tus últimos 10 minutos: no hace falta configurarla.', 'It recalculates itself from your last 10 minutes: no setup needed.')}</p></article>

      <article className="panel"><span>{t('MIS SENSORES · STELLAR NODE', 'MY SENSORS · STELLAR NODE')}</span>
        <ul className="sensor-list">{sensors.map(s => <li key={s.name}><i className={s.real ? 'real' : ''} /><div><b>{s.name}</b><small>{s.what}</small></div><em>{s.state}</em></li>)}</ul></article>

      <article className="panel"><span>{t('PRIVACIDAD Y ACCESO', 'PRIVACY AND ACCESS')}</span>
        <p>{access}</p>
        <p className="muted">{t('Los datos viajan del ESP32 a la base de datos de la misión con una clave que solo permite escribir; leerlos requiere el servidor de STELLAR.', 'Data travels from the ESP32 to the mission database with a write-only key; reading it requires the STELLAR server.')}</p>
        <p className="muted">{t('Datos de salud simulados con fines de demostración. No es un dispositivo médico.', 'Health data simulated for demonstration. Not a medical device.')}</p></article>
    </div>
  </section>
}
