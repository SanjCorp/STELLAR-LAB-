import { useEffect, useState } from 'react'
import ExerciseCoach from './ExerciseCoach'
import WellnessCheck from './WellnessCheck'
import ProfilePicker from './ProfilePicker'
import CrewCommand from './CrewCommand'
import SettingsPanel from './SettingsPanel'
import { profiles, type CrewProfile } from './profiles'
import { apiFetch } from './api'
import { levelInfo, type Alert, type Baseline, type SignalBaseline, type Vitals } from './health'
import Icon, { type IconName } from './Icon'
import { AlertBar, AlertCenter } from './AlertCenter'
import { metricAlertLevel, useAlertTracker } from './alertLog'
import MissionControl from './MissionControl'
import EvaView from './EvaView'
import Monitoring from './Monitoring'
import HealthAnalytics from './HealthAnalytics'
import CrewProfileView from './CrewProfileView'
import DemoPanel from './DemoPanel'
import WristView from './WristView'
import { Line, type Sample } from './charts'
import { bpLabel, LangSwitch, nodeTag, locale, missionDay, roleLabel, t, tempLabel, useLang } from './i18n'

// Pantallas: la clave interna sigue en inglés; el texto visible depende del idioma.
function screens(): Record<string, { label: string; icon: IconName; subtitle: string }> {
  return {
    Dashboard: { label: t('Panel principal', 'Dashboard'), icon: 'inicio', subtitle: t('Tu salud frente a tu propia línea base', 'Your health against your own baseline') },
    Monitoring: { label: t('Monitorización', 'Monitoring'), icon: 'monitorizacion', subtitle: t('Señales crudas del STELLAR Node en vivo y calidad de señal', 'Live raw signals from the STELLAR Node and signal quality') },
    EVA: { label: t('Posición EVA', 'EVA position'), icon: 'cohete', subtitle: t('Dónde estás respecto a la cápsula, en 3D y en tiempo real', 'Where you are relative to the capsule, in 3D and in real time') },
    Wellness: { label: t('Bienestar', 'Wellness'), icon: 'bienestar', subtitle: t('Tu equilibrio en la misión: chequeo diario y recuperación', 'Your balance on the mission: daily check-in and recovery') },
    'Exercise Coach': { label: t('Entrenamiento', 'Training'), icon: 'entrenamiento', subtitle: t('Rutinas guiadas contra la pérdida de músculo y hueso', 'Guided routines against muscle and bone loss') },
    'Crew Profile': { label: t('Mi perfil', 'My profile'), icon: 'perfil', subtitle: t('Quién eres, tus sensores y tu normal', 'Who you are, your sensors and your normal') },
    'Health Analytics': { label: t('Análisis de salud', 'Health analytics'), icon: 'analisis', subtitle: t('Tendencias, qué mide cada indicador y los peligros del espacio', 'Trends, what each indicator measures and spaceflight hazards') },
    Settings: { label: t('Configuración', 'Settings'), icon: 'configuracion', subtitle: t('Idioma y estado del sistema', 'Language and system status') },
    'Crew Command': { label: t('Gestión de tripulación', 'Crew command'), icon: 'tripulacion', subtitle: t('Estado de toda la tripulación (solo lectura)', 'Whole crew status (read only)') },
    'Mission Control': { label: t('Control de misión', 'Mission control'), icon: 'control-mision', subtitle: t('Reportes automáticos para los médicos en Tierra', 'Automatic reports for flight surgeons on Earth') },
    'System Settings': { label: t('Configuración del sistema', 'System settings'), icon: 'chip', subtitle: t('Idioma y estado del sistema', 'Language and system status') },
  }
}
const screen = (key: string) => screens()[key] ?? { label: key, icon: 'destello-ia' as IconName, subtitle: '' }

function Metric({ label, value, unit, note, tone = 'mint', tag, icon, alert = 0, onAlert }: { label: string; value: string | number; unit?: string; note: string; tone?: string; tag?: string; icon?: IconName; alert?: number; onAlert?: () => void }) {
  return <article className={`metric ${tone} ${alert ? `has-alert l${alert}` : ''}`}><div className="metric-top"><span>{icon && <Icon name={icon} size={18} />}{label}</span>{alert ? <button className="metric-alert" onClick={onAlert} title={t('Ver la alerta', 'See the alert')}><Icon name="alertas" size={11} />N{alert}</button> : tag ? <em className="metric-tag">{tag}</em> : <i />}</div><strong>{value}<small>{unit}</small></strong><p>{note}</p></article>
}

function signalNote(signal?: SignalBaseline) {
  if (!signal) return t('Calibrando línea base…', 'Calibrating baseline…')
  return signal.message
}

function timeLabel(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
}

export default function App() {
  const lang = useLang()
  const [profile, setProfile] = useState<CrewProfile | null>(null)
  const [active, setActive] = useState('Dashboard')
  const [sample, setSample] = useState<Sample | null>(null)
  const [series, setSeries] = useState<Sample[]>([])
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [vitals, setVitals] = useState<Vitals | null>(null)
  const [connected, setConnected] = useState(false)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [alertsOwner, setAlertsOwner] = useState<string | null>(null)
  const [alertFocus, setAlertFocus] = useState<{ id?: string; n: number }>({ n: 0 })
  const [clock, setClock] = useState(() => new Date())
  const [demoTick, setDemoTick] = useState(0)
  // Modo muñeca: se abre con el botón del encabezado o con ?muneca en la URL; se recuerda en este navegador.
  const [wrist, setWristState] = useState(() => {
    try { return new URLSearchParams(location.search).has('muneca') || localStorage.getItem('stellar-wrist') === '1' } catch { return false }
  })
  const setWrist = (on: boolean) => { setWristState(on); try { localStorage.setItem('stellar-wrist', on ? '1' : '0') } catch { /* sin almacenamiento */ } }

  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 1000); return () => window.clearInterval(timer) }, [])

  // Alertas: cada 5 s (combinan línea base, vitales y chequeo diario).
  useEffect(() => {
    if (!profile || profile.access === 'nasa') { setAlerts([]); setAlertsOwner(null); return }
    let alive = true
    const load = async () => {
      try { const res = await apiFetch(`/api/alerts?astronaut_id=${profile.id}`); if (res.ok && alive) { setAlerts((await res.json()).items); setAlertsOwner(profile.id) } } catch { /* sin cambios */ }
    }
    load(); const timer = window.setInterval(load, demoTick ? 3000 : 5000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [profile?.id, profile?.access, active, lang, demoTick])

  useEffect(() => {
    if (!profile || profile.access === 'nasa') return
    let alive = true
    const astronautId = profile.id
    setBaseline(null)
    const refresh = async () => {
      try {
        const [stateRes, historyRes] = await Promise.all([apiFetch(`/api/state?astronaut_id=${astronautId}`), apiFetch(`/api/history?astronaut_id=${astronautId}&limit=90`)])
        if (!stateRes.ok || !historyRes.ok) throw new Error('API unavailable')
        const state = await stateRes.json(); const history = await historyRes.json()
        if (alive) { setSample(state); setSeries(history.items); setBaseline(history.baseline ?? null); setConnected(true) }
      } catch { if (alive) setConnected(false) }
    }
    refresh(); const timer = window.setInterval(refresh, 900)
    return () => { alive = false; window.clearInterval(timer) }
  }, [profile?.id, profile?.access, lang])

  // Presión y temperatura cambian cada 30 min: basta consultar cada 20 s (más seguido con un escenario de demo).
  useEffect(() => {
    if (!profile || profile.access === 'nasa') return
    let alive = true
    const load = async () => {
      try { const res = await apiFetch(`/api/vitals?astronaut_id=${profile.id}`); if (res.ok && alive) setVitals(await res.json()) } catch { /* sin cambios */ }
    }
    load(); const timer = window.setInterval(load, demoTick ? 5000 : 20000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [profile?.id, profile?.access, active, demoTick])

  const tracker = useAlertTracker(profile && profile.access !== 'nasa' ? profile.id : null, alerts, alertsOwner)
  const showAlerts = (id?: string) => { setActive('Dashboard'); setAlertFocus(f => ({ id, n: f.n + 1 })) }
  const hrBase = baseline?.signals?.heart_rate_bpm
  const rrBase = baseline?.signals?.respiration_rate_bpm
  const hr = sample?.heart_rate_bpm ?? null
  const respirationRate = sample?.respiration_rate_bpm ?? null
  const ecg = series.map(s => s.ecg_raw)
  const respiration = series.map(s => s.resp_raw)
  const hrSeries = series.map(s => s.leads_off ? null : s.heart_rate_bpm)
  const rrSeries = series.map(s => s.leads_off ? null : s.respiration_rate_bpm)
  const distance = sample?.pos_x_m != null && sample?.pos_y_m != null ? Math.hypot(sample.pos_x_m, sample.pos_y_m, sample.pos_z_m ?? 0) : null
  const hasImu = sample?.az != null
  const movement = series.map(s => s.ax == null || s.ay == null || s.az == null ? null : Math.sqrt(s.ax ** 2 + s.ay ** 2 + s.az ** 2))
  const overall = levelInfo(baseline?.level)
  const bp = vitals?.latest_bp, temp = vitals?.latest_temp
  const live = sample?.source === 'hardware'
  const nodeName = `${t('Nodo', 'Node')} ${profile?.node ?? '?'}`
  const sourceTag = (source?: string) => source === 'manual' ? 'MANUAL' : source === 'hardware' ? nodeTag(profile?.node, true) : t('SIMULADO', 'SIMULATED')
  const issues = [hrBase, rrBase].filter(s => s && ['observe', 'alert', 'unreliable'].includes(s.level)) as SignalBaseline[]

  if (!profile) return <ProfilePicker profiles={profiles} onSelect={selected => { setProfile(selected); setActive(selected.access === 'nasa' ? 'Mission Control' : 'Dashboard') }} />

  if (wrist && profile.access !== 'nasa') return <WristView profile={profile} sample={sample} baseline={baseline} alerts={alerts} vitals={vitals} connected={connected} onExit={() => setWrist(false)} />

  const crew = profiles.filter(item => item.access !== 'nasa')
  const nav = profile.access === 'nasa' ? [] : ['Dashboard', 'Monitoring', 'EVA', 'Wellness', 'Exercise Coach', 'Crew Profile', 'Health Analytics', 'Settings']
  const authorized = profile.access === 'nasa' ? ['Mission Control', 'System Settings'] : profile.access === 'captain' ? ['Crew Command', 'Mission Control'] : []
  const activeAlerts = alerts.filter(a => a.level >= 1)
  const maxLevel = Math.max(0, ...alerts.map(a => a.level))
  const lastSync = sample ? Math.max(0, Math.round((clock.getTime() - Date.parse(sample.received_at)) / 1000)) : null
  const navButton = (item: string) => <button className={active === item ? 'active' : ''} onClick={() => setActive(item)} key={item}>
    <Icon name={screen(item).icon} size={20} />{screen(item).label}
    {item === 'Dashboard' && activeAlerts.length > 0 && <span className={`nav-badge ${maxLevel >= 3 ? 'crit' : ''}`}>{activeAlerts.length}</span>}
  </button>
  const accessBadge = profile.access === 'captain' ? t('ACCESO COMANDANTE', 'COMMANDER ACCESS') : profile.access === 'nasa' ? t('EQUIPO MÉDICO · TIERRA', 'MEDICAL TEAM · EARTH') : t('VISTA PERSONAL', 'PERSONAL VIEW')
  const role = roleLabel(profile.role)

  let content
  if (active === 'Crew Command' && profile.access === 'captain') content = <CrewCommand crew={crew} />
  else if (active === 'Mission Control' && profile.access !== 'crew') content = <MissionControl crew={crew} />
  else if (active === 'EVA') content = <EvaView astronautId={profile.id} name={profile.shortName} />
  else if (active === 'Exercise Coach') content = <ExerciseCoach sample={sample} astronautId={profile.id} />
  else if (active === 'Wellness') content = <WellnessCheck astronautId={profile.id} />
  else if (active === 'Settings' || active === 'System Settings') content = <SettingsPanel profile={profile} />
  else if (active === 'Monitoring') content = <Monitoring sample={sample} series={series} baseline={baseline} lastSync={lastSync} />
  else if (active === 'Health Analytics') content = <HealthAnalytics astronautId={profile.id} baseline={baseline} vitals={vitals} />
  else if (active === 'Crew Profile') content = <CrewProfileView profile={profile} sample={sample} baseline={baseline} vitals={vitals} />
  else content = <>
    <section className="challenge-strip"><span>{t('RECOPILAR', 'COLLECT')}</span><i/> <span>{t('EVALUAR', 'EVALUATE')}</span><i/> <span>{t('ACTUAR', 'ACT')}</span><p>{t('Reto NASA Space Apps 2026 · Health Monitoring Software · Prototipo educativo, no es un dispositivo médico', 'NASA Space Apps 2026 challenge · Health Monitoring Software · Educational prototype, not a medical device')}</p></section>
    <section className="intro"><div><span>{profile.name.toUpperCase()} · {role.toUpperCase()} · {t('DÍA DE MISIÓN', 'MISSION DAY')} {missionDay()}</span><h2>{t('Hola', 'Hello')}, {profile.shortName}</h2><p>{t('Pulso, respiración y movimiento comparados con tu propia línea base.', 'Heart rate, breathing and movement compared with your own baseline.')}</p></div><div className={`risk level-${maxLevel >= 3 ? 'alert' : maxLevel === 2 ? 'observe' : baseline?.level ?? 'calibrating'}`}><i /> {t('Estado actual', 'Current status')} <strong>{maxLevel >= 3 ? t('CRÍTICO · NIVEL 3', 'CRITICAL · LEVEL 3') : maxLevel === 2 ? t('ATENCIÓN · NIVEL 2', 'ATTENTION · LEVEL 2') : overall.label.toUpperCase()}</strong></div></section>

    <AlertBar alerts={alerts} tracker={tracker} now={clock.getTime()} onShow={showAlerts} />

    <section className="metrics six">
      <Metric icon="corazon" label={t('Frecuencia cardiaca', 'Heart rate')} value={hr ?? '—'} unit={` ${t('lpm', 'bpm')}`} note={signalNote(hrBase)} tone={levelInfo(hrBase?.level).tone} tag={nodeTag(profile.node, live)} alert={metricAlertLevel('heart', alerts)} onAlert={() => showAlerts()} />
      <Metric icon="pulmones" label={t('Frecuencia respiratoria', 'Breathing rate')} value={respirationRate?.toFixed(1) ?? '—'} unit={` ${t('rpm', 'br/min')}`} note={signalNote(rrBase)} tone={levelInfo(rrBase?.level).tone} tag={nodeTag(profile.node, live)} alert={metricAlertLevel('breath', alerts)} onAlert={() => showAlerts()} />
      <Metric icon="gota" label={t('Presión arterial', 'Blood pressure')} value={bp ? `${bp.systolic_mmhg}/${bp.diastolic_mmhg ?? '—'}` : '—'} unit=" mmHg" note={bp ? `${bpLabel(bp.bp_label)} · ${sourceTag(bp.source).toLowerCase()} ${timeLabel(bp.ts)}` : t('Sin medición', 'No reading')} tone={bp?.bp_label === 'normal' ? 'mint' : 'amber'} tag={bp ? sourceTag(bp.source) : undefined} alert={metricAlertLevel('bp', alerts)} onAlert={() => showAlerts()} />
      <Metric icon="termometro" label={t('Temperatura', 'Temperature')} value={temp?.temperature_c?.toFixed(1) ?? '—'} unit=" °C" note={temp ? `${tempLabel(temp.temp_label)} · ${sourceTag(temp.source).toLowerCase()} ${timeLabel(temp.ts)}` : t('Sin medición', 'No reading')} tone={temp?.temp_label === 'normal' ? 'cyan' : temp?.temp_label === 'fiebre' ? 'red' : 'amber'} tag={temp ? sourceTag(temp.source) : undefined} alert={metricAlertLevel('temp', alerts)} onAlert={() => showAlerts()} />
      <Metric icon="senal" label={t('Señal ECG', 'ECG signal')} value={sample?.leads_off ? 'OFF' : (sample?.ecg_raw ?? '—')} unit=" raw" note={sample?.leads_off ? t('Lectura poco confiable: revisa los electrodos', 'Unreliable reading: check the electrodes') : t('Electrodos detectados', 'Electrodes detected')} tone={sample?.leads_off ? 'gray' : 'blue'} alert={metricAlertLevel('ecg', alerts)} onAlert={() => showAlerts()} />
      <Metric icon="chip" label={t('Batería del nodo', 'Node battery')} value={sample?.battery_pct ?? '—'} unit={sample?.battery_pct == null ? '' : ' %'} note={sample?.battery_pct == null ? t('Sin sensor de batería', 'No battery sensor') : sample.source === 'hardware' ? t('Reportada por el ESP32', 'Reported by the ESP32') : t('Simulada', 'Simulated')} tone="violet" />
    </section>

    <AlertCenter alerts={alerts} tracker={tracker} now={clock.getTime()} focus={alertFocus} onOpen={setActive} />

    <section className="data-grid">
      <article className="panel trend-panel"><div className="panel-head"><div><span>{t('PULSO · TU LÍNEA BASE', 'HEART RATE · YOUR BASELINE')}</span><h3>{t('Pulso vs. tu normal', 'Heart rate vs. your normal')}</h3></div><b className={`level-pill level-${hrBase?.level ?? 'calibrating'}`}>{levelInfo(hrBase?.level).label}</b></div><Line values={hrSeries} band={hrBase ?? undefined} color="#58e6c2" /><div className="chart-meta"><span>{t('VENTANA', 'WINDOW')} · {series.length} s</span><span>{hrBase?.center != null ? `BASE ${hrBase.center} ± ${(2 * (hrBase.sd ?? 0)).toFixed(0)} ${t('lpm', 'bpm')}` : t('CALIBRANDO', 'CALIBRATING')}</span><span>{hrBase?.z != null ? `z = ${hrBase.z}` : '—'}</span></div></article>
      <article className="panel trend-panel"><div className="panel-head"><div><span>{t('RESPIRACIÓN · TU LÍNEA BASE', 'BREATHING · YOUR BASELINE')}</span><h3>{t('Respiración vs. tu normal', 'Breathing vs. your normal')}</h3></div><b className={`level-pill level-${rrBase?.level ?? 'calibrating'}`}>{levelInfo(rrBase?.level).label}</b></div><Line values={rrSeries} band={rrBase ?? undefined} color="#56d9ef" /><div className="chart-meta"><span>{t('VENTANA', 'WINDOW')} · {series.length} s</span><span>{rrBase?.center != null ? `BASE ${rrBase.center} ± ${(2 * (rrBase.sd ?? 0)).toFixed(1)} ${t('rpm', 'br/min')}` : t('CALIBRANDO', 'CALIBRATING')}</span><span>{rrBase?.z != null ? `z = ${rrBase.z}` : '—'}</span></div></article>
      <article className="panel ecg-panel"><div className="panel-head"><div><span>ECG / AD8232</span><h3>{t('Actividad cardiaca', 'Cardiac activity')}</h3></div><b className="live"><i /> LIVE</b></div><Line values={ecg} /><div className="chart-meta"><span>{t('VENTANA', 'WINDOW')} · {series.length} s</span><span>ADC · 12 bit</span><span>{sample?.leads_off ? t('ELECTRODOS SUELTOS', 'LEADS OFF') : t('SEÑAL ACTIVA', 'SIGNAL ACTIVE')}</span></div></article>
      <article className="panel respiration-panel"><div className="panel-head"><div><span>{t('RESPIRACIÓN · DERIVADA DEL ECG', 'BREATHING · ECG-DERIVED')}</span><h3>{t('Ciclo de respiración', 'Breathing cycle')}</h3></div><b>{respirationRate?.toFixed(1) ?? '—'} {t('rpm', 'br/min')}</b></div><Line values={respiration} color="#56d9ef" /><div className="chart-meta"><span>{t('ESTIMADA DESDE EL ECG (EDR)', 'ESTIMATED FROM THE ECG (EDR)')}</span><span>{sample?.source === 'hardware' ? 'ESP32' : t('SIMULACIÓN', 'SIMULATION')}</span><span>{levelInfo(rrBase?.level).label.toUpperCase()}</span></div></article>
      <article className="panel footprint eva-mini"><div className="panel-head"><div><span>{t('POSICIÓN · PUNTO 0 = CÁPSULA', 'POSITION · POINT 0 = CAPSULE')}</span><h3>{t('Distancia a la cápsula', 'Distance to the capsule')}</h3></div><b>{distance != null ? `${distance.toFixed(1)} m` : '—'}</b></div>
        <div className="eva-mini-body"><Icon name="cohete" size={46} /><div><p>X <b>{sample?.pos_x_m?.toFixed(1) ?? '—'}</b> · Y <b>{sample?.pos_y_m?.toFixed(1) ?? '—'}</b> · Z <b>{sample?.pos_z_m?.toFixed(1) ?? '—'}</b> m</p><p>{sample?.source === 'hardware' ? t('Estimada por el ESP32 con el MPU6050.', 'Estimated by the ESP32 with the MPU6050.') : t('Trayectoria simulada de una caminata espacial.', 'Simulated spacewalk path.')}</p></div></div>
        <button className="link-btn" onClick={() => setActive('EVA')}>{t('Ver en 3D', 'View in 3D')}<Icon name="flecha-derecha" size={14} /></button></article>
      <article className="panel motion"><div className="panel-head"><div><span>{t('MOVIMIENTO', 'MOVEMENT')}</span><h3>{t('Aceleración del pie', 'Foot acceleration')}</h3></div><b>{hasImu && sample ? Math.sqrt((sample.ax ?? 0) ** 2 + (sample.ay ?? 0) ** 2 + (sample.az ?? 0) ** 2).toFixed(2) : '—'} m/s²</b></div><Line values={movement} color="#ffb55c" /><div className="vectors"><span>AX <b>{sample?.ax?.toFixed(2) ?? '—'}</b></span><span>AY <b>{sample?.ay?.toFixed(2) ?? '—'}</b></span><span>AZ <b>{sample?.az?.toFixed(2) ?? '—'}</b></span></div></article>
      <article className={`panel insight level-${baseline?.level ?? 'calibrating'}`}><span>{t('STELLAR AI · EVALUAR', 'STELLAR AI · EVALUATE')}</span>
        <h3>{overall.title}</h3>
        {issues.length ? <ul className="insight-reasons">{issues.map(s => <li key={s.label}>{s.message}</li>)}</ul>
          : <p>{baseline?.level === 'calibrating' ? t('Reuniendo tus primeras lecturas para conocer tu normal. Tarda menos de un minuto.', 'Collecting your first readings to learn your normal. It takes less than a minute.') : t('Tus señales están dentro de tu propia línea base (no de un promedio general).', 'Your signals are within your own baseline (not a general average).')}</p>}
        <p className="insight-method">{t('Cómo se calcula', 'How it is calculated')}: {baseline?.method ?? t('mediana de tus últimos 10 min ± 2 desviaciones', 'median of your last 10 min ± 2 deviations')}.</p>
        <button onClick={() => activeAlerts.length ? showAlerts() : setActive('Exercise Coach')}>{activeAlerts.length ? t(`Ver ${activeAlerts.length} alerta${activeAlerts.length > 1 ? 's' : ''} y qué hacer`, `See ${activeAlerts.length} alert${activeAlerts.length > 1 ? 's' : ''} and what to do`) : t('Abrir rutina recomendada', 'Open recommended routine')}</button><div><i /> {t('Revisión automática cada 5 s', 'Automatic check every 5 s')}</div></article>
    </section>
  </>

  return <div className="app-shell">
    <aside>
      <div className="brand"><img src="/brand/logo-cian.svg" alt="" /><b>STELLAR<em>Health</em></b></div>
      <nav>{nav.map(navButton)}</nav>
      {authorized.length > 0 && <><p className="nav-section">{t('PERSONAL AUTORIZADO', 'AUTHORIZED STAFF')}</p><nav>{authorized.map(navButton)}</nav></>}
      <div className="sync-card"><div><b className={connected ? '' : 'off'}><i />{connected ? (live ? t(`${nodeName} conectado`, `${nodeName} connected`) : t(`${nodeName} sin señal · simulación`, `${nodeName} no signal · simulation`)) : profile.access === 'nasa' ? t('Estación de Tierra', 'Ground station') : t('Sin conexión', 'Offline')}</b>{lastSync != null && <span>{live && sample?.device_id ? `${sample.device_id} · ` : ''}{t(`hace ${lastSync} s`, `${lastSync} s ago`)}</span>}</div><Icon name="senal" size={22} /></div>
      <p className="version">STELLAR LAB · v0.5 · {t('No es un dispositivo médico', 'Not a medical device')}</p>
    </aside>

    <main>
      <div className="topbar">
        <div className="mission"><Icon name="cohete" size={26} /><div><b>{t('Misión', 'Mission')} STELLAR-01</b><small>{t(`Día ${missionDay()} · larga duración`, `Day ${missionDay()} · long duration`)}</small></div></div>
        <span className="divider" />
        <span className={`sys ${!connected && profile.access !== 'nasa' ? 'off' : sample?.source === 'hardware' ? '' : 'sim'}`}><i />{profile.access === 'nasa' ? t('Enlace con el hábitat', 'Habitat link') : !connected ? t('API desconectada', 'API offline') : live ? t(`Sistema en línea · ${nodeName} (ESP32)`, `System online · ${nodeName} (ESP32)`) : t('Sistema en línea · simulación', 'System online · simulation')}</span>
        <span className="divider" />
        <span className="clock"><Icon name="reloj" size={18} />{clock.toISOString().slice(11, 16)} UTC</span>
        <span className="spacer" />
        <DemoPanel crew={crew} current={profile.id} onChange={() => setDemoTick(n => n + 1)} />
        {profile.access !== 'nasa' && <button className="wrist-btn" onClick={() => setWrist(true)} title={t('Pantalla para la muñeca del traje (celular en horizontal)', 'Suit wrist screen (phone sideways)')}><Icon name="reloj" size={16} />{t('Muñeca', 'Wrist')}</button>}
        <LangSwitch compact />
        {profile.access !== 'nasa' && <button className="bell" aria-label={t('Alertas', 'Alerts')} onClick={() => showAlerts()}><Icon name="alertas" size={18} />{activeAlerts.length > 0 && <em className={maxLevel >= 3 ? 'crit' : ''}>{activeAlerts.length}</em>}</button>}
        <button className="who" onClick={() => setProfile(null)} aria-label={t('Cambiar perfil', 'Switch profile')}>{profile.photo ? <img src={profile.photo} alt="" /> : <span className="ini">{profile.initials}</span>}<div><b>{profile.name}</b><small>{role} · {t('cambiar perfil', 'switch profile')}</small></div><Icon name="chevron-abajo" size={14} /></button>
      </div>
      {active !== 'Exercise Coach' && <div className="page-title"><Icon name={screen(active).icon} size={40} /><div><h1>{screen(active).label}</h1><p>{screen(active).subtitle}</p></div><span className={`access-badge access-${profile.access}`}>{accessBadge}</span></div>}
      {content}
    </main>
  </div>
}
