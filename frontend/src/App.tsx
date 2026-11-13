import { useEffect, useMemo, useState } from 'react'
import ExerciseCoach from './ExerciseCoach'
import WellnessCheck from './WellnessCheck'
import ProfilePicker from './ProfilePicker'
import CrewCommand from './CrewCommand'
import SettingsPanel from './SettingsPanel'
import { profiles, type CrewProfile } from './profiles'
import { apiFetch } from './api'

type Sample = {
  astronaut_id: string; source: 'simulation' | 'hardware'; received_at: string; ecg_raw: number; leads_off: boolean;
  resp_raw: number; respiration_rate_bpm: number | null;
  heart_rate_bpm: number | null; ax: number; ay: number; az: number; gx: number; gy: number; gz: number;
  pos_x_m: number; pos_y_m: number; area_m2: number; steps: number; battery_pct: number;
}

const navIcons: Record<string, string> = { Dashboard: '⌁', Monitoring: '⌇', 'Crew Command': '▦', 'Exercise Coach': '◇', Wellness: '◌', 'Crew Profile': '◉', 'Health Analytics': '↗', Alerts: '△', 'Mission Control': '✦', Settings: '⚙', 'System Settings': '⚙' }

function Line({ values, color = '#58e6c2' }: { values: number[]; color?: string }) {
  const points = useMemo(() => {
    if (!values.length) return ''
    const min = Math.min(...values), max = Math.max(...values), span = max - min || 1
    return values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${38 - ((v - min) / span) * 32}`).join(' ')
  }, [values])
  return <svg className="spark" viewBox="0 0 100 42" preserveAspectRatio="none" aria-label="Gráfico en tiempo real"><polyline points={points} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" /></svg>
}

function Metric({ label, value, unit, note, tone = 'mint' }: { label: string; value: string | number; unit?: string; note: string; tone?: string }) {
  return <article className={`metric ${tone}`}><div className="metric-top"><span>{label}</span><i /></div><strong>{value}<small>{unit}</small></strong><p>{note}</p></article>
}

export default function App() {
  const [profile, setProfile] = useState<CrewProfile | null>(null)
  const [active, setActive] = useState('Dashboard')
  const [sample, setSample] = useState<Sample | null>(null)
  const [series, setSeries] = useState<Sample[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!profile || profile.access === 'nasa') return
    let alive = true
    const astronautId = profile.id
    const refresh = async () => {
      try {
        const [stateRes, historyRes] = await Promise.all([apiFetch(`/api/state?astronaut_id=${astronautId}`), apiFetch(`/api/history?astronaut_id=${astronautId}&limit=90`)])
        if (!stateRes.ok || !historyRes.ok) throw new Error('API unavailable')
        const state = await stateRes.json(); const history = await historyRes.json()
        if (alive) { setSample(state); setSeries(history.items); setConnected(true) }
      } catch { if (alive) setConnected(false) }
    }
    refresh(); const timer = window.setInterval(refresh, 900)
    return () => { alive = false; window.clearInterval(timer) }
  }, [profile?.id, profile?.access])

  const hr = sample?.heart_rate_bpm ?? (sample ? Math.round(68 + (sample.ecg_raw - 1900) / 120) : 0)
  const ecg = series.map(s => s.ecg_raw)
  const respiration = series.map(s => s.resp_raw)
  const movement = series.map(s => Math.sqrt(s.ax ** 2 + s.ay ** 2 + s.az ** 2))
  const respirationRate = sample?.respiration_rate_bpm ?? 15.6

  if (!profile) return <ProfilePicker profiles={profiles} onSelect={selected => { setProfile(selected); setActive(selected.access === 'nasa' ? 'System Settings' : 'Dashboard') }} />

  const crew = profiles.filter(item => item.access !== 'nasa')
  const nav = profile.access === 'nasa' ? ['System Settings'] : ['Dashboard', 'Monitoring', ...(profile.access === 'captain' ? ['Crew Command'] : []), 'Exercise Coach', 'Wellness', 'Crew Profile', 'Health Analytics', 'Alerts', 'Mission Control', 'Settings']

  return <div className="app-shell">
    <aside>
      <div className="brand"><div className="mark">S</div><div><b>STELLAR</b><span>HEALTH SYSTEM</span></div></div>
      <nav>{nav.map(item => <button className={active === item ? 'active' : ''} onClick={() => setActive(item)} key={item}><span>{navIcons[item]}</span>{item}</button>)}</nav>
      <div className="mission-card"><span>NASA SPACE APPS 2026</span><b>LONG-DURATION CREW 01</b><div><i /> Onboard systems nominal</div></div>
      <button className="switch-profile" onClick={() => setProfile(null)}>{profile.photo ? <img src={profile.photo} alt="" /> : <span>{profile.initials}</span>}<div><b>{profile.shortName}</b><small>Switch profile</small></div><i>↗</i></button>
      <p className="version">STELLAR LAB · Prototype v0.2</p>
    </aside>

    <main>
      <header><div><p>{profile.access === 'nasa' ? 'MISSION SYSTEMS' : 'CREW HEALTH'} / {active.toUpperCase()}</p><h1>{active}</h1></div><div className="header-actions"><span className={`access-badge access-${profile.access}`}>{profile.access === 'captain' ? 'COMMANDER ACCESS' : profile.access === 'nasa' ? 'NASA TECH' : 'PERSONAL VIEW'}</span><span className={`status ${connected ? '' : 'offline'}`}><i />{connected ? (sample?.source === 'hardware' ? 'ESP32 conectado' : 'Simulación local') : 'API desconectada'}</span><button aria-label="Notificaciones">⌁</button><button className="avatar" onClick={() => setProfile(null)} aria-label="Cambiar perfil">{profile.initials}</button></div></header>

      {active === 'Crew Command' && profile.access === 'captain' ? <CrewCommand crew={crew} /> : active === 'Exercise Coach' ? <ExerciseCoach sample={sample} /> : active === 'Wellness' ? <WellnessCheck /> : active === 'Settings' || active === 'System Settings' ? <SettingsPanel profile={profile} /> : active !== 'Dashboard' && active !== 'Monitoring' ? <section className="placeholder">
        <span>{navIcons[active]}</span><p>STELLAR HEALTH</p><h2>{active}</h2><div className="rule" />
        <p>Este módulo forma parte de la arquitectura prevista. En el siguiente ciclo conectaremos sus datos, reglas y flujos específicos.</p>
        <button onClick={() => setActive('Dashboard')}>Volver al Dashboard</button>
      </section> : <>
        <section className="challenge-strip"><span>RECOPILAR</span><i/> <span>EVALUAR</span><i/> <span>ACTUAR</span><p>Reto NASA Space Apps 2026 · Health Monitoring Software</p></section>
        <section className="intro"><div><span>{profile.name.toUpperCase()} · {profile.role.toUpperCase()} · MISSION DAY 042</span><h2>My health and movement</h2><p>Heart, respiration and movement compared with your personal baseline.</p></div><div className="risk"><i /> Current status <strong>STABLE</strong></div></section>

        <section className="metrics">
          <Metric label="Frecuencia cardiaca" value={hr || '—'} unit=" bpm" note="Dentro de línea base" />
          <Metric label="Frecuencia respiratoria" value={respirationRate.toFixed(1)} unit=" rpm" note="Patrón respiratorio estable" tone="cyan" />
          <Metric label="Señal ECG" value={sample?.leads_off ? 'OFF' : (sample?.ecg_raw ?? '—')} unit=" raw" note={sample?.leads_off ? 'Revisar electrodos' : 'Electrodos detectados'} tone="blue" />
          <Metric label="Área recorrida" value={sample?.area_m2?.toFixed(2) ?? '—'} unit=" m²" note={`${sample?.steps ?? 0} pasos estimados`} tone="amber" />
          <Metric label="Batería Node" value={sample?.battery_pct ?? '—'} unit=" %" note="Autonomía estimada" tone="violet" />
        </section>

        <section className="data-grid">
          <article className="panel ecg-panel"><div className="panel-head"><div><span>ECG / AD8232</span><h3>Actividad cardiaca</h3></div><b className="live"><i /> LIVE</b></div><Line values={ecg} /><div className="chart-meta"><span>VENTANA · 90 s</span><span>ADC · 12 bit</span><span>{sample?.leads_off ? 'ELECTRODOS SUELTOS' : 'SEÑAL ACTIVA'}</span></div></article>
          <article className="panel respiration-panel"><div className="panel-head"><div><span>CINTURÓN RESPIRATORIO</span><h3>Ciclo de respiración</h3></div><b>{respirationRate.toFixed(1)} rpm</b></div><Line values={respiration} color="#56d9ef" /><div className="chart-meta"><span>INHALACIÓN / EXHALACIÓN</span><span>ADC · GPIO 35</span><span>PATRÓN ESTABLE</span></div></article>
          <article className="panel footprint"><div className="panel-head"><div><span>IMU / MPU6050</span><h3>Zona de movimiento</h3></div><b>{sample?.area_m2?.toFixed(2) ?? '0.00'} m²</b></div><div className="map"><div className="orbit one"/><div className="orbit two"/><div className="trail"/><div className="dot" style={{left: `${50 + Math.min(38, Math.max(-38, (sample?.pos_x_m ?? 0) * 15))}%`, top: `${50 + Math.min(35, Math.max(-35, (sample?.pos_y_m ?? 0) * 18))}%`}}><i/></div><span className="axis x">X</span><span className="axis y">Y</span></div><p>Estimación 2D con corrección de reposo. La deriva del IMU se reinicia desde Arduino IDE.</p></article>
          <article className="panel motion"><div className="panel-head"><div><span>MOVIMIENTO</span><h3>Aceleración del pie</h3></div><b>{sample ? Math.sqrt(sample.ax ** 2 + sample.ay ** 2 + sample.az ** 2).toFixed(2) : '—'} m/s²</b></div><Line values={movement} color="#ffb55c" /><div className="vectors"><span>AX <b>{sample?.ax?.toFixed(2) ?? '—'}</b></span><span>AY <b>{sample?.ay?.toFixed(2) ?? '—'}</b></span><span>AZ <b>{sample?.az?.toFixed(2) ?? '—'}</b></span></div></article>
          <article className="panel insight"><span>STELLAR AI · EVALUAR Y ACTUAR</span><h3>Patrón estable</h3><p>Las señales actuales no muestran una desviación relevante frente a la línea base de demostración.</p><button onClick={() => setActive('Exercise Coach')}>Abrir rutina recomendada</button><div><i /> Revisión automática en curso</div></article>
        </section>
      </>}
    </main>
  </div>
}

