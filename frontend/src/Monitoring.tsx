import { Line, type Sample } from './charts'
import type { Baseline } from './health'
import { levelInfo } from './health'
import { locale, t } from './i18n'
import { nodeNumber } from './profiles'

// Monitorización = vista técnica EN VIVO de lo que manda el STELLAR Node (señales crudas,
// calidad de señal y el último paquete). El Panel principal, en cambio, resume y explica.
const mag = (a: number | null, b: number | null, c: number | null) => a == null || b == null || c == null ? null : Math.sqrt(a * a + b * b + c * c)

function quality(sample: Sample | null) {
  if (!sample) return { tone: 'gray', title: t('Sin datos', 'No data'), text: '' }
  if (sample.leads_off) return { tone: 'red', title: t('Poco confiable', 'Unreliable'), text: t('El AD8232 indica electrodos sueltos: pulso y respiración no se usan para la línea base.', 'The AD8232 reports loose electrodes: heart rate and breathing are not used for the baseline.') }
  const accel = mag(sample.ax, sample.ay, sample.az)
  if (accel != null && accel > 0.5 && Math.abs(accel - 9.81) > 4) return { tone: 'amber', title: t('Movimiento fuerte', 'Strong movement'), text: t('Mucho movimiento: el ECG puede tener ruido. Quédate quieto para una lectura limpia.', 'Lots of movement: the ECG may be noisy. Stay still for a clean reading.') }
  return { tone: 'mint', title: t('Buena', 'Good'), text: t('Electrodos detectados y poco movimiento.', 'Electrodes detected and little movement.') }
}

export default function Monitoring({ sample, series, baseline, lastSync }: { sample: Sample | null; series: Sample[]; baseline: Baseline | null; lastSync: number | null }) {
  const hw = sample?.source === 'hardware'
  const q = quality(sample)
  const hrBase = baseline?.signals?.heart_rate_bpm, rrBase = baseline?.signals?.respiration_rate_bpm
  const accel = series.map(s => mag(s.ax, s.ay, s.az))
  const gyro = series.map(s => mag(s.gx, s.gy, s.gz))
  const axes: [string, number | null | undefined, string][] = [['AX', sample?.ax, 'm/s²'], ['AY', sample?.ay, 'm/s²'], ['AZ', sample?.az, 'm/s²'], ['GX', sample?.gx, '°/s'], ['GY', sample?.gy, '°/s'], ['GZ', sample?.gz, '°/s']]
  const packet = sample ? Object.entries(sample).filter(([k]) => !['source', 'received_at', 'scenario'].includes(k)) : []

  return <section className="monitor-page">
    <div className="monitor-strip">
      <span className={`src ${hw ? 'real' : ''}`}><i />{hw ? t(`NODO ${nodeNumber(sample!.astronaut_id)} EN VIVO`, `NODE ${nodeNumber(sample!.astronaut_id)} LIVE`) : t('SIMULACIÓN', 'SIMULATION')}</span>
      <span>{t('Dispositivo', 'Device')} <b>{sample?.device_id ?? '—'}</b></span>
      <span>{t('Última lectura', 'Last reading')} <b>{lastSync != null ? t(`hace ${lastSync} s`, `${lastSync} s ago`) : '—'}</b></span>
      <span>{t('Batería', 'Battery')} <b>{sample?.battery_pct != null ? `${sample.battery_pct} %` : '—'}</b></span>
      <span className={`q ${q.tone}`}>{t('Calidad de señal', 'Signal quality')}: <b>{q.title}</b></span>
      {sample?.scenario && <span className="q amber">{t('Escenario de demo activo', 'Demo scenario active')}</span>}
    </div>

    <div className="monitor-grid">
      <article className="panel monitor-ecg"><div className="panel-head"><div><span>ECG · AD8232 · ADC 12 bit</span><h3>{t('Electrocardiograma', 'Electrocardiogram')}</h3></div><div className="big-num"><b>{sample?.heart_rate_bpm ?? '—'}</b><small>{t('lpm', 'bpm')}</small><em className={`level-pill level-${hrBase?.level ?? 'calibrating'}`}>{levelInfo(hrBase?.level).label}</em></div></div>
        <Line values={series.map(s => s.ecg_raw)} className="tall" />
        <div className="chart-meta"><span>{t('VENTANA', 'WINDOW')} · {series.length} s</span><span>{t('1 punto por segundo', '1 point per second')}</span><span>{sample?.leads_off ? t('ELECTRODOS SUELTOS', 'LEADS OFF') : t('SEÑAL ACTIVA', 'SIGNAL ACTIVE')}</span></div>
        <p className="monitor-note">{q.text}</p></article>

      <article className="panel"><div className="panel-head"><div><span>{t('RESPIRACIÓN · DERIVADA DEL ECG (EDR)', 'BREATHING · ECG-DERIVED (EDR)')}</span><h3>{t('Onda respiratoria', 'Breathing wave')}</h3></div><div className="big-num"><b>{sample?.respiration_rate_bpm?.toFixed(1) ?? '—'}</b><small>{t('rpm', 'br/min')}</small><em className={`level-pill level-${rrBase?.level ?? 'calibrating'}`}>{levelInfo(rrBase?.level).label}</em></div></div>
        <Line values={series.map(s => s.resp_raw)} color="#56d9ef" />
        <div className="chart-meta"><span>resp_raw</span><span>{t('la amplitud del QRS cambia al respirar', 'QRS amplitude changes with breathing')}</span></div></article>

      <article className="panel"><div className="panel-head"><div><span>MPU6050 · {t('ACELERÓMETRO', 'ACCELEROMETER')}</span><h3>{t('Aceleración total', 'Total acceleration')}</h3></div><div className="big-num"><b>{accel.at(-1)?.toFixed(2) ?? '—'}</b><small>m/s²</small></div></div>
        <Line values={accel} color="#ffb55c" /><div className="chart-meta"><span>{t('en reposo ≈ 9,81 (gravedad) · en órbita ≈ 0', 'at rest ≈ 9.81 (gravity) · in orbit ≈ 0')}</span></div></article>

      <article className="panel"><div className="panel-head"><div><span>MPU6050 · {t('GIROSCOPIO', 'GYROSCOPE')}</span><h3>{t('Velocidad de giro', 'Rotation speed')}</h3></div><div className="big-num"><b>{gyro.at(-1)?.toFixed(1) ?? '—'}</b><small>°/s</small></div></div>
        <Line values={gyro} color="#a98dff" />
        <div className="imu-axes">{axes.map(([k, v, u]) => <div key={k}><small>{k}</small><b>{v != null ? v.toFixed(2) : '—'}</b><small>{u}</small></div>)}</div></article>

      <article className="panel monitor-packet"><div className="panel-head"><div><span>{t('ÚLTIMO PAQUETE', 'LAST PACKET')}</span><h3>{t('Lo que envió el STELLAR Node', 'What the STELLAR Node sent')}</h3></div><b>{sample ? new Date(sample.received_at).toLocaleTimeString(locale()) : '—'}</b></div>
        <dl>{packet.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v == null ? 'null' : typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v)}</dd></div>)}</dl>
        <p className="monitor-note">{hw ? t('Una fila por envío del ESP32 (vía Supabase). Si deja de llegar 10 s, el perfil pasa a simulación.', 'One row per ESP32 upload (via Supabase). If nothing arrives for 10 s, the profile falls back to simulation.') : t('Datos simulados con el mismo formato que envía el ESP32.', 'Simulated data with the same format the ESP32 sends.')}</p></article>
    </div>
  </section>
}
