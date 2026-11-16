import { useEffect, useState } from 'react'
import Icon from './Icon'
import { apiFetch } from './api'
import { levelInfo, type Report } from './health'
import { bpLabel, locale, roleLabel, t, tempLabel, useLang } from './i18n'
import type { CrewProfile } from './profiles'

// Retraso de la señal (solo ida) según dónde esté la tripulación.
const environments = () => [
  { id: 'iss', label: t('Órbita terrestre (estación)', 'Earth orbit (station)'), delay_s: 1 },
  { id: 'moon', label: t('Base en la Luna', 'Moon base'), delay_s: 1.3 },
  { id: 'mars-near', label: t('Marte · distancia mínima', 'Mars · closest'), delay_s: 3 * 60 },
  { id: 'mars-avg', label: t('Marte · distancia media', 'Mars · average'), delay_s: 12.5 * 60 },
  { id: 'mars-far', label: t('Marte · distancia máxima', 'Mars · farthest'), delay_s: 22 * 60 },
]
type Env = ReturnType<typeof environments>[number]

const utc = (ts: number) => new Date(ts * 1000).toISOString().slice(11, 16) + ' UTC'
const delayText = (s: number) => s < 60 ? `${s.toLocaleString(locale())} s` : `${Math.round(s / 60)} min`
const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`
const srcText = (s?: string | null) => s === 'manual' ? 'manual' : s === 'hardware' ? 'ESP32' : t('simulada', 'simulated')

function reportText(r: Report, who: CrewProfile | undefined, env: Env) {
  const hr = r.summary.heart_rate_bpm, rr = r.summary.respiration_rate_bpm
  const lines = [
    t('STELLAR HEALTH · REPORTE PARA MÉDICOS EN TIERRA', 'STELLAR HEALTH · REPORT FOR FLIGHT SURGEONS ON EARTH'),
    `${t('Tripulante', 'Crew member')}: ${who?.name ?? r.astronaut_id} (${who ? roleLabel(who.role) : ''})`,
    `${t('Generado', 'Generated')}: ${new Date(r.generated_ts * 1000).toISOString()} · ${r.trigger} · ${t('Prioridad', 'Priority')}: ${r.priority}`,
    `${t('Entorno', 'Environment')}: ${env.label} · ${t('retraso de señal', 'signal delay')} ${delayText(env.delay_s)}`,
    '',
    `${t('Pulso', 'Heart rate')}: ${hr?.now ?? '—'} ${t('lpm', 'bpm')} (base ${hr?.base ?? '—'}, z ${hr?.z ?? '—'})`,
    `${t('Respiración', 'Breathing')}: ${rr?.now ?? '—'} ${t('rpm', 'br/min')} (base ${rr?.base ?? '—'}, z ${rr?.z ?? '—'})`,
    `${t('Presión', 'Blood pressure')}: ${r.vitals.bp ? `${r.vitals.bp.systolic_mmhg}/${r.vitals.bp.diastolic_mmhg} mmHg (${srcText(r.vitals.bp.source)})` : '—'}`,
    `${t('Temperatura', 'Temperature')}: ${r.vitals.temp ? `${r.vitals.temp.temperature_c} °C (${srcText(r.vitals.temp.source)})` : '—'}`,
    `${t('Chequeo', 'Check-in')}: ${r.checkin ? t(`sueño ${r.checkin.sleep_hours ?? '—'} h, ánimo ${r.checkin.mood ?? '—'}/5, tensión ${r.checkin.stress ?? '—'}/5, glucosa ${r.checkin.glucose_mg_dl ?? '—'} mg/dL`, `sleep ${r.checkin.sleep_hours ?? '—'} h, mood ${r.checkin.mood ?? '—'}/5, stress ${r.checkin.stress ?? '—'}/5, glucose ${r.checkin.glucose_mg_dl ?? '—'} mg/dL`) : t('sin chequeo en 24 h', 'no check-in in 24 h')}`,
    '',
    `${t('Alertas', 'Alerts')}:`,
    ...(r.alerts.length ? r.alerts.map(a => `  - ${t('Nivel', 'Level')} ${a.level}: ${a.title}. ${a.reason}`) : [`  - ${t('Ninguna', 'None')}`]),
    '',
    `${t('Recomendación a bordo', 'Onboard recommendation')}: ${r.recommendation}`,
    `${t('Fuentes', 'Sources')}: ECG ${r.data_source.ecg ?? '—'} · ${t('vitales', 'vitals')} ${r.data_source.vitals ?? '—'} · ${t('chequeo', 'check-in')} ${r.data_source.checkin ?? '—'}`,
    '',
    t('Prototipo educativo (NASA Space Apps 2026). No es un dispositivo médico. Datos compartidos con consentimiento del tripulante.', 'Educational prototype (NASA Space Apps 2026). Not a medical device. Data shared with the crew member’s consent.'),
  ]
  return lines.join('\n')
}

export default function MissionControl({ crew }: { crew: CrewProfile[] }) {
  const lang = useLang()
  const [reports, setReports] = useState<Report[]>([])
  const [selected, setSelected] = useState(crew[0]?.id)
  const [envId, setEnvId] = useState('mars-avg')
  const [offline, setOffline] = useState(false)
  const envs = environments()
  const env = envs.find(e => e.id === envId) ?? envs[0]

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await apiFetch('/api/mission-report')
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json(); if (alive) { setReports(data.items); setOffline(false) }
      } catch { if (alive) setOffline(true) }
    }
    load(); const timer = window.setInterval(load, 5000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [lang])

  const byId = Object.fromEntries(reports.map(r => [r.astronaut_id, r]))
  const report = selected ? byId[selected] : undefined
  const who = crew.find(c => c.id === selected)
  const hr = report?.summary.heart_rate_bpm, rr = report?.summary.respiration_rate_bpm

  const download = () => {
    if (!report) return
    const blob = new Blob([reportText(report, who, env)], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `${t('reporte', 'report')}-${report.astronaut_id}-${new Date(report.generated_ts * 1000).toISOString().slice(0, 16).replace(':', '')}.txt`
    a.click(); URL.revokeObjectURL(a.href)
  }
  const plain = { paddingLeft: 0 }

  return <section className="mc-page">
    <div className="mc-bar">
      <Icon name="control-mision" size={22} className="accent" />
      <label>{t('Ubicación de la tripulación', 'Crew location')}
        <select value={envId} onChange={e => setEnvId(e.target.value)}>{envs.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</select>
      </label>
      <span className="delay">{t('Retraso de la señal', 'Signal delay')}: <b>{delayText(env.delay_s)}</b> {t('por trayecto', 'one way')}{offline && t(' · sin conexión con el hábitat', ' · no link with the habitat')}</span>
    </div>

    <div className="mc-crew">{crew.map(c => {
      const r = byId[c.id]
      return <button key={c.id} className={selected === c.id ? 'sel' : ''} onClick={() => setSelected(c.id)}>
        {c.photo ? <img src={c.photo} alt="" /> : <span className="ini">{c.initials}</span>}
        <div><b>{c.name}</b><small>{r ? r.priority : t('Esperando reporte…', 'Waiting for report…')}</small><small>{r?.alerts[0]?.title ?? (r ? t('Sin alertas', 'No alerts') : '')}</small></div>
        {r && <span className={`lv l${r.max_level}`}>{r.max_level || '✓'}</span>}
      </button>
    })}</div>

    {report && <article className="mc-report">
      <div className="mc-head">
        <Icon name="analisis" size={26} />
        <div><h2>{t('Reporte de', 'Report for')} {who?.name ?? report.astronaut_id}</h2><p>{report.trigger} · {t('generado', 'generated')} {utc(report.generated_ts)} · {t('llega a Tierra', 'reaches Earth')} ≈ {utc(report.generated_ts + env.delay_s)}</p></div>
        <span className={`prio p${report.max_level}`}>{report.priority.toUpperCase()}</span>
      </div>

      <div className="mc-grid">
        <div><span>{t('Pulso · ahora / base', 'Heart rate · now / baseline')}</span><b>{hr?.now ?? '—'} <small>/ {hr?.base ?? '—'} {t('lpm', 'bpm')}</small></b><small>{levelInfo(hr?.level).label}{hr?.z != null && ` · z ${hr.z}`}</small></div>
        <div><span>{t('Respiración · ahora / base', 'Breathing · now / baseline')}</span><b>{rr?.now ?? '—'} <small>/ {rr?.base ?? '—'} {t('rpm', 'br/min')}</small></b><small>{levelInfo(rr?.level).label}{rr?.z != null && ` · z ${rr.z}`}</small></div>
        <div><span>{t('Presión arterial', 'Blood pressure')}</span><b>{report.vitals.bp ? `${report.vitals.bp.systolic_mmhg}/${report.vitals.bp.diastolic_mmhg}` : '—'} <small>mmHg</small></b><small>{report.vitals.bp ? `${bpLabel(report.vitals.bp.bp_label)} · ${srcText(report.vitals.bp.source)}` : ''}</small></div>
        <div><span>{t('Temperatura', 'Temperature')}</span><b>{report.vitals.temp?.temperature_c ?? '—'} <small>°C</small></b><small>{report.vitals.temp ? `${tempLabel(report.vitals.temp.temp_label)} · ${srcText(report.vitals.temp.source)}` : ''}</small></div>
      </div>

      <div>
        <p className="mc-section-title">{t('CHEQUEO DIARIO (MANUAL)', 'DAILY CHECK-IN (MANUAL)')}</p>
        <p className="mc-list" style={plain}>{report.checkin ? t(`Sueño ${report.checkin.sleep_hours ?? '—'} h · ánimo ${report.checkin.mood ?? '—'}/5 · tensión ${report.checkin.stress ?? '—'}/5 · glucosa ${report.checkin.glucose_mg_dl ?? '—'} mg/dL`, `Sleep ${report.checkin.sleep_hours ?? '—'} h · mood ${report.checkin.mood ?? '—'}/5 · stress ${report.checkin.stress ?? '—'}/5 · glucose ${report.checkin.glucose_mg_dl ?? '—'} mg/dL`) : t('Sin chequeo en las últimas 24 h.', 'No check-in in the last 24 h.')}</p>
      </div>

      <div>
        <p className="mc-section-title">{t('ALERTAS Y MOTIVO', 'ALERTS AND REASON')}</p>
        {report.alerts.length ? <ul className="mc-list">{report.alerts.map(a => <li key={a.title}><span className={`lv l${a.level}`} style={{ minWidth: 20, height: 20, fontSize: 11, marginRight: 8 }}>{a.level}</span><b>{a.title}.</b> {a.reason}</li>)}</ul> : <p className="mc-list" style={plain}>{t('Sin alertas: el tripulante está dentro de su línea base.', 'No alerts: the crew member is within their baseline.')}</p>}
      </div>

      <div>
        <p className="mc-section-title">{t('ACCIÓN YA INDICADA A BORDO', 'ACTION ALREADY GIVEN ONBOARD')}</p>
        <p className="mc-list" style={plain}>{report.recommendation}</p>
      </div>

      <div className="mc-tx">
        <span>{t('Se envía un', 'A')} <b>{t(`resumen de ${kb(report.size_bytes)}`, `${kb(report.size_bytes)} summary`)}</b> {t(`en lugar de ${kb(report.raw_bytes)} de datos crudos`, `is sent instead of ${kb(report.raw_bytes)} of raw data`)} ({Math.max(1, Math.round(report.raw_bytes / report.size_bytes))}× {t('menos', 'less')}), {t('útil con conectividad limitada.', 'useful with limited connectivity.')}</span>
        <span>{t('Fuentes', 'Sources')}: ECG <b>{report.data_source.ecg === 'hardware' ? 'ESP32' : t('simulado', 'simulated')}</b> · {t('vitales', 'vitals')} <b>{report.data_source.vitals ? srcText(report.data_source.vitals) : '—'}</b> · {t('chequeo', 'check-in')} <b>{report.data_source.checkin ?? '—'}</b></span>
        <button className="link-btn" onClick={download}>{t('Descargar reporte (.txt)', 'Download report (.txt)')}<Icon name="flecha-derecha" size={14} /></button>
      </div>
    </article>}

    <p className="disclaimer">{t('Vista de solo lectura para el equipo médico. Los datos se comparten con consentimiento del tripulante. Prototipo educativo: no es un dispositivo médico.', 'Read-only view for the medical team. Data is shared with the crew member’s consent. Educational prototype: not a medical device.')}</p>
  </section>
}
