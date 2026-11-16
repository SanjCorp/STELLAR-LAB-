import { useEffect, useState } from 'react'
import { apiFetch } from './api'
import { Line, type Sample } from './charts'
import { levelInfo, type Baseline, type Checkin, type SignalBaseline, type Vitals } from './health'
import { locale, t } from './i18n'
const fmtRad = (v: number) => v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)

type Src = 'real' | 'sim' | 'manual' | 'none'

// Qué mide cada indicador, de dónde sale y por qué importa en el espacio.
const indicators = (): { name: string; src: Src; how: string; why: string; hazard: string }[] => [
  { name: t('Pulso', 'Heart rate'), src: 'real', how: t('ECG con AD8232 (ESP32)', 'ECG with AD8232 (ESP32)'), why: t('Sin gravedad los líquidos suben al pecho y el corazón se desacondiciona; un pulso alto en reposo puede indicar esfuerzo, fiebre o estrés.', 'Without gravity fluids shift to the chest and the heart deconditions; a high resting heart rate can point to effort, fever or stress.'), hazard: 'gravity' },
  { name: t('Respiración', 'Breathing'), src: 'real', how: t('Derivada del ECG (EDR)', 'ECG-derived (EDR)'), why: t('Sube con el esfuerzo, el estrés o con CO₂ alto en una cabina cerrada.', 'Rises with effort, stress or high CO₂ in a closed cabin.'), hazard: 'closed' },
  { name: t('Movimiento y postura', 'Movement and posture'), src: 'real', how: 'MPU6050', why: t('El ejercicio diario frena la pérdida de músculo y hueso (hasta ~1 % de masa ósea al mes).', 'Daily exercise slows muscle and bone loss (up to ~1% of bone mass per month).'), hazard: 'gravity' },
  { name: t('Posición en EVA', 'EVA position'), src: 'sim', how: t('MPU6050 (estimada) o trayectoria simulada', 'MPU6050 (estimated) or simulated path'), why: t('Fuera de la nave, alejarse más que el cable de seguridad es un riesgo inmediato.', 'Outside the spacecraft, going beyond the safety tether is an immediate risk.'), hazard: 'closed' },
  { name: t('Presión arterial', 'Blood pressure'), src: 'sim', how: t('Enviada por el ESP32 (valor de prueba, aún sin sensor) o, si no llega, simulada cada 30 min', 'Sent by the ESP32 (test value, no sensor yet) or, if missing, simulated every 30 min'), why: t('El cambio de líquidos altera la presión; al volver a la gravedad puede haber mareo.', 'Fluid shift changes blood pressure; on return to gravity it can cause dizziness.'), hazard: 'gravity' },
  { name: t('Temperatura', 'Temperature'), src: 'sim', how: t('Enviada por el ESP32 (valor de prueba, aún sin sensor) o, si no llega, simulada cada 30 min', 'Sent by the ESP32 (test value, no sensor yet) or, if missing, simulated every 30 min'), why: t('En un ambiente cerrado una infección se contagia fácil y el sistema inmune cambia en vuelo.', 'In a closed environment infections spread easily and immunity changes in flight.'), hazard: 'closed' },
  { name: t('Radiación', 'Radiation'), src: 'sim', how: t('Sensor de la nave vía ESP32 (µSv/h) o, si no llega, simulada · se ve en Posición EVA', 'Ship sensor via ESP32 (µSv/h) or, if missing, simulated · shown in EVA position'), why: t('Lejos del escudo magnético de la Tierra la dosis sube; en una tormenta solar la tripulación debe dejar la EVA e ir al refugio.', 'Away from Earth’s magnetic shield the dose rises; in a solar storm the crew must end the EVA and go to the shelter.'), hazard: 'radiation' },
  { name: t('Sueño, ánimo y tensión', 'Sleep, mood and stress'), src: 'manual', how: t('Chequeo diario', 'Daily check-in'), why: t('El aislamiento y los horarios alterados afectan el sueño y el ánimo, y con ellos el rendimiento.', 'Isolation and shifted schedules affect sleep and mood, and with them performance.'), hazard: 'isolation' },
  { name: t('Glucosa', 'Glucose'), src: 'manual', how: t('Chequeo diario (recordatorio)', 'Daily check-in (reminder)'), why: t('Lejos de la Tierra no hay hospital: hay que detectar a tiempo valores fuera de rango.', 'Far from Earth there is no hospital: out-of-range values must be caught early.'), hazard: 'distance' },
]

const hazards = (): { key: string; letter: string; title: string; text: string; covered: boolean }[] => [
  { key: 'radiation', letter: 'R', title: t('Radiación', 'Radiation'), text: t('Tasa de dosis de la nave en µSv/h con niveles y acción (volver a la cápsula, ir al refugio). Simulada hasta tener el sensor.', 'Ship dose rate in µSv/h with levels and action (return to the capsule, go to the shelter). Simulated until the sensor arrives.'), covered: true },
  { key: 'isolation', letter: 'I', title: t('Aislamiento y confinamiento', 'Isolation and confinement'), text: t('Chequeo diario de sueño, ánimo y tensión, con alertas cuando se combinan.', 'Daily check-in for sleep, mood and stress, with alerts when they combine.'), covered: true },
  { key: 'distance', letter: 'D', title: t('Distancia a la Tierra', 'Distance from Earth'), text: t('Alertas por niveles que dicen quién actúa y reportes compactos para enlaces lentos.', 'Tiered alerts that say who acts, and compact reports for slow links.'), covered: true },
  { key: 'gravity', letter: 'G', title: t('Campos de gravedad', 'Gravity fields'), text: t('Pulso y presión frente a tu línea base; entrenamiento guiado con el MPU6050.', 'Heart rate and blood pressure vs. your baseline; guided training with the MPU6050.'), covered: true },
  { key: 'closed', letter: 'E', title: t('Ambiente cerrado y hostil', 'Hostile and closed environment'), text: t('Respiración, temperatura y distancia en la EVA.', 'Breathing, temperature and EVA distance.'), covered: true },
]
const hazardName = (key: string) => hazards().find(h => h.key === key)?.title ?? key
const vitalsTag = (src?: string) => src === 'hardware' ? 'ESP32' : src === 'manual' ? 'MANUAL' : t('SIMULADO', 'SIMULATED')
const srcLabel = (s: Src) => ({ real: t('REAL', 'REAL'), sim: t('SIMULADO', 'SIMULATED'), manual: 'MANUAL', none: '—' })[s]

function BaseCard({ s, unit }: { s?: SignalBaseline; unit: string }) {
  const info = levelInfo(s?.level)
  return <article className={`panel base-card ${info.tone}`}><span>{s?.label ?? '—'}</span>
    <div className="base-row"><div><small>{t('Tu normal', 'Your normal')}</small><b>{s?.center ?? '—'}<em> {unit}</em></b></div><div><small>{t('Rango normal', 'Normal range')}</small><b>{s?.low != null ? `${s.low.toFixed(0)}–${s.high?.toFixed(0)}` : '—'}</b></div><div><small>{t('Ahora', 'Now')}</small><b>{s?.current ?? '—'}</b></div><div><small>z</small><b>{s?.z ?? '—'}</b></div></div>
    <p><em className={`level-pill level-${s?.level ?? 'calibrating'}`}>{info.label}</em> {s?.message ?? ''}</p>
    <small className="muted">{t(`Basada en ${s?.n ?? 0} lecturas propias`, `Based on ${s?.n ?? 0} of your own readings`)}</small></article>
}

export default function HealthAnalytics({ astronautId, baseline, vitals }: { astronautId: string; baseline: Baseline | null; vitals: Vitals | null }) {
  const [series, setSeries] = useState<Sample[]>([])
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [rad, setRad] = useState<{ dose_rate_usvh: number; level: number; source: string; thresholds_usvh: number[]; max_usvh?: number; history: [number, number][] } | null>(null)
  useEffect(() => {
    let alive = true
    const load = async () => { try { const r = await apiFetch('/api/radiation'); if (r.ok && alive) setRad(await r.json()) } catch { /* sin cambios */ } }
    load(); const id = window.setInterval(load, 5000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])
  useEffect(() => {
    let alive = true
    const load = async () => {
      try { const r = await apiFetch(`/api/history?astronaut_id=${astronautId}&limit=240`); if (r.ok && alive) setSeries((await r.json()).items) } catch { /* sin cambios */ }
    }
    load(); const id = window.setInterval(load, 5000)
    apiFetch(`/api/checkins?astronaut_id=${astronautId}&days=7`).then(r => r.ok ? r.json() : null).then(d => { if (d && alive) setCheckins(d.items) }).catch(() => {})
    return () => { alive = false; window.clearInterval(id) }
  }, [astronautId])

  const hr = baseline?.signals?.heart_rate_bpm, rr = baseline?.signals?.respiration_rate_bpm
  const vItems = vitals?.items ?? []
  const hour = (ts: number) => new Date(ts * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
  const recent = [...checkins].reverse().slice(-7)

  return <section className="analytics-page">
    <div className="analytics-heading"><span>{t('EVALUAR · TU LÍNEA BASE PERSONAL', 'EVALUATE · YOUR PERSONAL BASELINE')}</span><h2>{t('Tendencias y qué significan', 'Trends and what they mean')}</h2><p>{t('STELLAR no te compara con un promedio general: aprende tu normal y avisa cuando te alejas de él. ', 'STELLAR does not compare you with a general average: it learns your normal and warns you when you drift from it. ')}{baseline?.method ?? ''}.</p></div>

    <div className="analytics-grid two">
      <BaseCard s={hr} unit={t('lpm', 'bpm')} />
      <BaseCard s={rr} unit={t('rpm', 'br/min')} />
      <article className="panel"><div className="panel-head"><div><span>{t('PULSO · ÚLTIMOS 4 MIN', 'HEART RATE · LAST 4 MIN')}</span><h3>{t('Franja = tu rango normal', 'Band = your normal range')}</h3></div></div><Line values={series.map(s => s.leads_off ? null : s.heart_rate_bpm)} band={hr ?? undefined} /></article>
      <article className="panel"><div className="panel-head"><div><span>{t('RESPIRACIÓN · ÚLTIMOS 4 MIN', 'BREATHING · LAST 4 MIN')}</span><h3>{t('Franja = tu rango normal', 'Band = your normal range')}</h3></div></div><Line values={series.map(s => s.leads_off ? null : s.respiration_rate_bpm)} band={rr ?? undefined} color="#56d9ef" /></article>
      <article className="panel"><div className="panel-head"><div><span>{t('PRESIÓN SISTÓLICA · ÚLTIMAS 6 H', 'SYSTOLIC PRESSURE · LAST 6 H')}</span><h3>{vitals?.latest_bp ? `${vitals.latest_bp.systolic_mmhg}/${vitals.latest_bp.diastolic_mmhg} mmHg` : '—'}</h3></div><em className="metric-tag">{vitalsTag(vitals?.latest_bp?.source)}</em></div><Line values={vItems.map(v => v.systolic_mmhg)} band={{ low: 90, high: 130 }} color="#79A9D8" /><div className="chart-meta"><span>{vItems[0] ? hour(vItems[0].ts) : ''}</span><span>{t('franja 90–130 mmHg (referencia general)', 'band 90–130 mmHg (general reference)')}</span><span>{vItems.at(-1) ? hour(vItems.at(-1)!.ts) : ''}</span></div></article>
      <article className="panel"><div className="panel-head"><div><span>{t('TEMPERATURA · ÚLTIMAS 6 H', 'TEMPERATURE · LAST 6 H')}</span><h3>{vitals?.latest_temp ? `${vitals.latest_temp.temperature_c} °C` : '—'}</h3></div><em className="metric-tag">{vitalsTag(vitals?.latest_temp?.source)}</em></div><Line values={vItems.map(v => v.temperature_c)} band={{ low: 36, high: 37.2 }} color="#F2B84B" /><div className="chart-meta"><span>{vItems[0] ? hour(vItems[0].ts) : ''}</span><span>{t('franja 36–37,2 °C', 'band 36–37.2 °C')}</span><span>{vItems.at(-1) ? hour(vItems.at(-1)!.ts) : ''}</span></div></article>
      <article className="panel"><div className="panel-head"><div><span>{t('RADIACIÓN EN LA NAVE · ÚLTIMOS 5 MIN', 'SHIP RADIATION · LAST 5 MIN')}</span><h3>{rad ? `${fmtRad(rad.dose_rate_usvh)} µSv/h · ${[t('nominal', 'nominal'), t('elevada', 'elevated'), t('alta', 'high'), t('tormenta solar', 'solar storm')][rad.level]}` : '—'}</h3></div><em className="metric-tag">{rad?.source === 'sensor' ? 'SENSOR' : t('SIMULADO', 'SIMULATED')}</em></div><Line values={rad?.history.map(h => h[1]) ?? []} band={{ low: 0, high: rad?.max_usvh ?? 17 }} color="#FFD84A" /><div className="chart-meta"><span>−5 min</span><span>{t(`franja = permitido hasta ${rad?.max_usvh ?? 17} µSv/h (0,017 mSv/h)`, `band = allowed up to ${rad?.max_usvh ?? 17} µSv/h (0.017 mSv/h)`)}</span><span>{t('ahora', 'now')}</span></div></article>
      <article className="panel"><div className="panel-head"><div><span>{t('SUEÑO Y ÁNIMO · 7 DÍAS', 'SLEEP AND MOOD · 7 DAYS')}</span><h3>{t('Desde tu chequeo diario', 'From your daily check-in')}</h3></div><em className="metric-tag">MANUAL</em></div>
        {recent.length ? <><div className="mini-bars">{recent.map(c => <div key={c.created_at}><i className="sleep" style={{ height: `${Math.min(100, ((c.sleep_hours ?? 0) / 10) * 100)}%` }} /><i className="mood" style={{ height: `${((c.mood ?? 0) / 5) * 100}%` }} /><small>{new Date(c.created_at).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' })}</small></div>)}</div>
          <div className="legend"><span><i className="sleep" />{t('Sueño (h)', 'Sleep (h)')}</span><span><i className="mood" />{t('Ánimo (1–5)', 'Mood (1–5)')}</span></div></>
          : <p className="muted">{t('Aún no hay chequeos. Guárdalos en Bienestar para ver la tendencia.', 'No check-ins yet. Save them in Wellness to see the trend.')}</p>}</article>
    </div>

    <h3 className="analytics-sub">{t('Qué mide cada indicador', 'What each indicator measures')}</h3>
    <div className="indicator-table" role="table">
      <div className="row thead" role="row"><span>{t('Indicador', 'Indicator')}</span><span>{t('Fuente', 'Source')}</span><span>{t('Por qué importa en el espacio', 'Why it matters in space')}</span><span>{t('Peligro NASA', 'NASA hazard')}</span></div>
      {indicators().map(i => <div className="row" role="row" key={i.name}><b>{i.name}</b><span><em className={`src-tag ${i.src}`}>{srcLabel(i.src)}</em><small>{i.how}</small></span><span>{i.why}</span><span className="hz">{hazardName(i.hazard)}</span></div>)}
    </div>

    <h3 className="analytics-sub">{t('Los 5 peligros del vuelo espacial (NASA)', 'The 5 hazards of human spaceflight (NASA)')}</h3>
    <div className="hazard-grid">{hazards().map(h => <article key={h.key} className={h.covered ? '' : 'off'}><b>{h.letter}</b><h4>{h.title}</h4><p>{h.text}</p><small>{h.covered ? t('CUBIERTO POR STELLAR', 'COVERED BY STELLAR') : t('NO MEDIDO', 'NOT MEASURED')}</small></article>)}</div>
    <p className="disclaimer">{t('Rangos de referencia generales. Prototipo educativo: no es un dispositivo médico.', 'General reference ranges. Educational prototype: not a medical device.')}</p>
  </section>
}
