import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { t } from './i18n'
import TrainingFigure, { useCycle, type Exercise } from './TrainingFigure'

// Pantalla "Entrenamiento" con el diseño de Chuy (the choy/INTERFAZ ENTRENAMIENTO.png) y el
// contexto de Entrenamiento.txt: fuerza en ARED (90 min) + cardio en T2 / CEVIS (60 min) = 2 h 30 min.
// El MPU6050 (si llega del ESP32) mide el ángulo y cuenta repeticiones; si no, se simula.

type MotionSample = {
  source?: string; received_at?: string; ax: number | null; ay: number | null; az: number | null
  gx: number | null; gy: number | null; gz: number | null; respiration_rate_bpm: number | null; heart_rate_bpm: number | null
}
type Block = 'ared' | 'cardio'
type Load = { value: number; step: number; min: number; max: number; unit: 'kg' | '%' | 'level' }
type Routine = {
  id: Exercise; block: Block; name: string; muscles: string; sets: number; reps: number | null; badge: string; rest: number
  minutes: number; load: Load; goal: number; sensor: string; cue: string; guide: string; why: string
}

const routines = (): Routine[] => [
  { id: 'squat', block: 'ared', name: t('Sentadillas', 'Squats'), muscles: t('Cuádriceps · Glúteos · Core', 'Quads · Glutes · Core'), sets: 4, reps: 10, badge: '4x10', rest: 90, minutes: 35,
    load: { value: 180, step: 5, min: 20, max: 272, unit: 'kg' }, goal: 80, sensor: t('MPU6050 en el muslo', 'MPU6050 on the thigh'),
    cue: t('Desciende con el torso estable y empuja desde los talones contra la resistencia del ARED.', 'Go down with a steady torso and push through your heels against the ARED resistance.'),
    guide: t('Barra sobre los hombros; flexiona cadera y rodillas de forma controlada con la espalda neutra. Descanso de 90 s entre series y carga según prescripción médica.', 'Bar on your shoulders; bend hips and knees under control with a neutral back. 90 s rest between sets, load as medically prescribed.'),
    why: t('Estimula fémur, cadera y pelvis para frenar la pérdida de hueso y conserva cuádriceps y glúteos para sostener tu peso al volver a la Tierra.', 'Loads femur, hips and pelvis to slow bone loss and keeps quads and glutes strong enough to carry your weight back on Earth.') },
  { id: 'deadlift', block: 'ared', name: t('Peso muerto', 'Deadlift'), muscles: t('Cadena posterior · Core', 'Posterior chain · Core'), sets: 4, reps: 8, badge: '4x8', rest: 90, minutes: 30,
    load: { value: 160, step: 5, min: 20, max: 272, unit: 'kg' }, goal: 60, sensor: t('MPU6050 en el muslo', 'MPU6050 on the thigh'),
    cue: t('Eleva la barra desde la plataforma extendiendo cadera y tronco, con el abdomen contraído.', 'Lift the bar from the platform by extending hips and trunk, with the core braced.'),
    guide: t('Extiende cadera y tronco manteniendo el core contraído para estabilizar el cuerpo sin gravedad. Descanso de 90 s.', 'Extend hips and trunk keeping the core braced to stabilise the body without gravity. 90 s rest.'),
    why: t('Protege la densidad de las vértebras lumbares y fortalece toda la cadena posterior: evita dolor de espalda y atrofia postural.', 'Protects lumbar bone density and strengthens the whole posterior chain: prevents back pain and postural atrophy.') },
  { id: 'calf', block: 'ared', name: t('Elevación de talones', 'Calf raises'), muscles: t('Gastrocnemios · Sóleo', 'Gastrocnemius · Soleus'), sets: 3, reps: 15, badge: '3x15', rest: 60, minutes: 25,
    load: { value: 90, step: 5, min: 20, max: 272, unit: 'kg' }, goal: 20, sensor: t('MPU6050 en el pie', 'MPU6050 on the foot'),
    cue: t('Con la barra en los hombros y las puntas en la plataforma, sube al máximo y baja lento.', 'With the bar on your shoulders and toes on the platform, rise all the way and lower slowly.'),
    guide: t('Extensión máxima de tobillos con descenso lento y controlado. Descanso de 60 s.', 'Full ankle extension with a slow, controlled lowering. 60 s rest.'),
    why: t('Evita la pérdida rápida de masa en las pantorrillas, clave para el equilibrio y para caminar tras el aterrizaje.', 'Prevents fast calf muscle loss, key for balance and walking after landing.') },
  { id: 'run', block: 'cardio', name: t('Carrera con arnés', 'Harness run'), muscles: t('Piernas · Sistema cardiovascular', 'Legs · Cardiovascular system'), sets: 1, reps: null, badge: '30 min', rest: 0, minutes: 30,
    load: { value: 62, step: 1, min: 30, max: 100, unit: 'kg' }, goal: 0, sensor: t('Pulso (ECG)', 'Heart rate (ECG)'),
    cue: t('Trote continuo con intervalos rápidos; el arnés y los bungees te empujan contra la banda.', 'Steady jog with fast intervals; the harness and bungees pull you against the belt.'),
    guide: t('30 a 45 min en la cinta T2. Chaleco y cinturón con bungees que aplican del 70 % al 80 % de tu peso contra la banda.', '30 to 45 min on the T2 treadmill. Vest and belt with bungees applying 70–80 % of your weight against the belt.'),
    why: t('Los impactos estimulan la regeneración del hueso de las piernas y mantienen el volumen de sangre y la capacidad aeróbica.', 'The impacts stimulate leg bone regeneration and keep blood volume and aerobic capacity.') },
  { id: 'cevis', block: 'cardio', name: t('Pedaleo en bicicleta estática CEVIS', 'CEVIS stationary cycling'), muscles: t('Cuádriceps · Glúteos · Sistema cardiovascular', 'Quads · Glutes · Cardiovascular system'), sets: 1, reps: null, badge: '15–30 min', rest: 0, minutes: 30,
    load: { value: 8, step: 1, min: 1, max: 12, unit: 'level' }, goal: 0, sensor: t('Pulso (ECG)', 'Heart rate (ECG)'),
    cue: t('Intervalos de alta intensidad con los pies anclados a los pedales y la pelvis sujeta al asiento.', 'High-intensity intervals with feet clipped to the pedals and the pelvis strapped to the seat.'),
    guide: t('15 a 30 min en formato HIIT vigilando la frecuencia cardiaca en tiempo real.', '15 to 30 min HIIT while watching your heart rate in real time.'),
    why: t('Fortalece la resistencia cardiovascular y el flujo de sangre a las piernas sin hacer vibrar la nave.', 'Builds cardiovascular endurance and blood flow to the legs without shaking the spacecraft.') },
]
const DAILY_MIN = 150 // 2 h 30 min

type Vec = [number, number, number]
type Rep = { peak: number; seconds: number; full: boolean }
const norm = (v: Vec) => Math.hypot(...v)
function angleBetween(a: Vec, b: Vec) {
  const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (norm(a) * norm(b))
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI
}
const mmss = (s: number) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.floor(min % 60)).padStart(2, '0')}`
const loadText = (l: Load) => l.unit === 'level' ? `${t('Nivel', 'Level')} ${l.value}` : `${l.value} ${l.unit}`

// Avance del día (casillas, series hechas, cargas) guardado en este navegador.
type Day = { done: Record<string, boolean>; sets: Record<string, number>; loads: Record<string, number> }
const dayKey = (aid: string) => `stellar-training-${aid}-${new Date().toISOString().slice(0, 10)}`
function loadDay(aid: string): Day {
  try { const raw = localStorage.getItem(dayKey(aid)); if (raw) return JSON.parse(raw) } catch { /* sin almacenamiento */ }
  return { done: {}, sets: {}, loads: {} }
}

export default function ExerciseCoach({ sample, astronautId = 'crew' }: { sample: MotionSample | null; astronautId?: string }) {
  const list = routines()
  const [filter, setFilter] = useState<'all' | Block>('all')
  const [selected, setSelected] = useState<Exercise>('squat')
  const [technique, setTechnique] = useState<Exercise | null>(null)
  const [day, setDay] = useState<Day>(() => loadDay(astronautId))
  const [phase, setPhase] = useState<'idle' | 'set' | 'rest'>('idle')
  const [clock, setClock] = useState(0) // segundos de la serie en curso o del descanso que queda
  const [reps, setReps] = useState<Rep[]>([])
  const [angle, setAngle] = useState<number | null>(null)
  const [neutral, setNeutral] = useState<Vec | null>(() => {
    try { const raw = localStorage.getItem(`stellar-neutral-${astronautId}`); return raw ? JSON.parse(raw) : null } catch { return null }
  })
  const [demoChoice, setDemoChoice] = useState<boolean | null>(null)
  const repState = useRef({ up: false, peak: 0, start: 0 })
  const lastSeen = useRef('')
  const setActive = phase === 'set'
  const activeRef = useRef(setActive); activeRef.current = setActive

  const routine = list.find(r => r.id === selected)!
  const index = list.indexOf(routine)
  const load: Load = { ...routine.load, value: day.loads[routine.id] ?? routine.load.value }
  const setsDone = Math.min(day.sets[routine.id] ?? 0, routine.sets)
  const usesSensor = routine.goal > 0
  const accel: Vec | null = sample && sample.ax != null && sample.ay != null && sample.az != null ? [sample.ax, sample.ay, sample.az] : null
  const imuLive = sample?.source === 'hardware' && accel != null && norm(accel) > 2 // con gravedad, en reposo ≈ 9,8 m/s²
  const demo = demoChoice ?? !imuLive
  const cycle = useCycle(setActive, routine.id === 'run' ? 0.8 : routine.id === 'cevis' ? 1.2 : 4)
  const guideF = 0.5 - 0.5 * Math.cos(2 * Math.PI * cycle)

  useEffect(() => { try { localStorage.setItem(dayKey(astronautId), JSON.stringify(day)) } catch { /* sin almacenamiento */ } }, [day, astronautId])

  // Reloj: sube durante la serie, baja durante el descanso.
  useEffect(() => {
    if (phase === 'idle') return
    const timer = window.setInterval(() => setClock(c => {
      if (phase === 'set') return c + 1
      if (c <= 1) { setPhase('idle'); return 0 }
      return c - 1
    }), 1000)
    return () => window.clearInterval(timer)
  }, [phase])

  const registerAngle = (value: number, now: number, goal: number) => {
    setAngle(value)
    if (!activeRef.current || goal <= 0) return
    const st = repState.current
    if (!st.up && value >= goal * 0.5) { st.up = true; st.peak = value; st.start = now }
    else if (st.up) {
      st.peak = Math.max(st.peak, value)
      if (value <= goal * 0.25) {
        const rep = { peak: Math.round(st.peak), seconds: Math.max(1, Math.round((now - st.start) / 1000)), full: st.peak >= goal * 0.85 }
        setReps(r => [...r, rep]); st.up = false; st.peak = 0
      }
    }
  }

  // Ángulo REAL: cada lectura nueva del ESP32.
  useEffect(() => {
    if (demo || !imuLive || !accel) return
    const key = sample?.received_at ?? ''
    if (key === lastSeen.current) return
    lastSeen.current = key
    registerAngle(neutral ? angleBetween(accel, neutral) : 0, Date.now(), routine.goal)
  }, [sample?.received_at, demo, imuLive, neutral, routine.goal])

  // Ángulo SIMULADO (demo) mientras hay una serie en curso.
  useEffect(() => {
    if (!demo || !usesSensor || !setActive) return
    const t0 = Date.now()
    const timer = window.setInterval(() => {
      const sec = (Date.now() - t0) / 1000, n = Math.floor(sec / 4)
      const reach = n % 4 === 3 ? 0.7 : 0.95
      registerAngle(Math.max(0, routine.goal * reach * (0.5 - 0.5 * Math.cos((2 * Math.PI * sec) / 4)) + Math.sin(sec * 7) * 2), Date.now(), routine.goal)
    }, 250)
    return () => window.clearInterval(timer)
  }, [demo, usesSensor, setActive, routine.goal])

  const select = (id: Exercise) => { if (id === selected) return; setSelected(id); setPhase('idle'); setClock(0); setReps([]); setAngle(null) }
  const toggleDone = (id: Exercise) => setDay(d => ({ ...d, done: { ...d.done, [id]: !d.done[id] } }))
  const start = () => {
    if (setActive) { setPhase('idle'); return } // pausa
    setReps([]); repState.current = { up: false, peak: 0, start: 0 }; setClock(0); setPhase('set')
  }
  const registerSet = () => {
    const next = setsDone + 1
    const finished = next >= routine.sets
    setDay(d => ({ ...d, sets: { ...d.sets, [routine.id]: next }, done: finished ? { ...d.done, [routine.id]: true } : d.done }))
    setReps([]); repState.current = { up: false, peak: 0, start: 0 }
    if (finished || !routine.rest) { setPhase('idle'); setClock(0) } else { setPhase('rest'); setClock(routine.rest) }
  }
  const changeLoad = (delta: number) => setDay(d => ({ ...d, loads: { ...d.loads, [routine.id]: Math.max(load.min, Math.min(load.max, load.value + delta * load.step)) } }))
  const resetLoad = () => setDay(d => { const loads = { ...d.loads }; delete loads[routine.id]; return { ...d, loads } })
  const calibrate = () => {
    if (!accel) return
    setNeutral(accel)
    try { localStorage.setItem(`stellar-neutral-${astronautId}`, JSON.stringify(accel)) } catch { /* sin almacenamiento */ }
  }

  // Tarjetas superiores
  const doneMin = list.reduce((sum, r) => sum + (day.done[r.id] ? r.minutes : (Math.min(day.sets[r.id] ?? 0, r.sets) / r.sets) * r.minutes), 0) + (setActive ? clock / 60 : 0)
  const harnessKg = day.loads.run ?? list.find(r => r.id === 'run')!.load.value
  const harnessPct = Math.round((harnessKg / 80) * 100) // referencia: masa corporal de 80 kg
  const hr = sample?.heart_rate_bpm != null ? Math.round(sample.heart_rate_bpm) : null
  const zone = hr == null ? { label: t('Sin lectura', 'No reading'), cls: 'off' } : hr < 100 ? { label: t('Zona de reposo', 'Resting zone'), cls: 'rest' } : hr <= 160 ? { label: t('Zona aeróbica', 'Aerobic zone'), cls: 'ok' } : { label: t('Zona alta: baja la intensidad', 'High zone: ease off'), cls: 'high' }
  const lastRep = reps[reps.length - 1]

  const group = (block: Block) => {
    const items = list.filter(r => r.block === block)
    return <article className="tp-group">
      <header>
        <Icon name={block === 'ared' ? 'entrenamiento' : 'monitorizacion'} size={20} />
        <div><b>{block === 'ared' ? t('Fuerza en ARED', 'ARED strength') : 'Cardio T2 / CEVIS'}</b><small>{block === 'ared' ? t('Dispositivo resistivo avanzado', 'Advanced resistive device') : t('Cinta con arnés y cicloergómetro', 'Harness treadmill and cycle ergometer')}</small></div>
        <em>{block === 'ared' ? '90 min' : '60 min'}</em>
      </header>
      {items.map(r => {
        const done = !!day.done[r.id]
        return <div key={r.id} className={`tp-row ${selected === r.id ? 'active' : ''} ${done ? 'done' : ''}`}>
          <div className="tp-row-main" onClick={() => select(r.id)}>
            <button className={`tp-check ${done ? 'on' : ''}`} aria-pressed={done} aria-label={done ? t('Marcar como pendiente', 'Mark as pending') : t('Marcar como hecho', 'Mark as done')} onClick={e => { e.stopPropagation(); toggleDone(r.id) }}>{done && <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>}</button>
            <div className="tp-name"><b>{r.name}</b><small>{r.muscles}</small></div>
            <span className="tp-badge">{r.badge}</span>
            <div className="tp-load"><small>{t('RESISTENCIA DE VACÍO', 'VACUUM RESISTANCE')}</small><b>{loadText({ ...r.load, value: day.loads[r.id] ?? r.load.value })}</b></div>
            <button className="tp-tech" aria-expanded={technique === r.id} onClick={e => { e.stopPropagation(); setTechnique(technique === r.id ? null : r.id) }}>{t('Ver técnica', 'View technique')} <Icon name={technique === r.id ? 'chevron-abajo' : 'flecha-derecha'} size={13} /></button>
          </div>
          {technique === r.id && <div className="tp-technique"><p><b>{t('Cómo se hace', 'How to do it')}</b>{r.guide}</p><p><b>{t('Para qué sirve', 'Why it matters')}</b>{r.why}</p></div>}
        </div>
      })}
    </article>
  }

  return <section className="tp-page">
    <div className="tp-heading">
      <div>
        <span>{t('RENDIMIENTO DIARIO', 'DAILY PERFORMANCE')}</span>
        <h2>{t('Protocolo de Entrenamiento Diario', 'Daily Training Protocol')} <em><Icon name="reloj" size={14} /> {t('2 h 30 min · Objetivo diario', '2 h 30 min · Daily goal')}</em></h2>
        <p>{t('Programa adaptado para preservar fuerza, densidad ósea y capacidad cardiovascular.', 'Programme adapted to preserve strength, bone density and cardiovascular capacity.')}</p>
      </div>
      <div className="tp-tabs" role="tablist">
        {([['all', t('Todos', 'All')], ['ared', t('Fuerza ARED', 'ARED strength')], ['cardio', 'Cardio T2 / CEVIS']] as const).map(([id, label]) =>
          <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{label}</button>)}
      </div>
    </div>

    <div className="tp-stats">
      <article><i><Icon name="reloj" size={20} /></i><div><small>{t('Tiempo completado', 'Time completed')}</small><b>{hhmm(doneMin)} <span>/ 02:30 hrs</span></b><div className="tp-progress"><i style={{ width: `${Math.min(100, (doneMin / DAILY_MIN) * 100)}%` }} /></div></div></article>
      <article><i><Icon name="entrenamiento" size={20} /></i><div><small>{t('Carga simulada en arnés', 'Simulated harness load')}</small><b>{harnessPct}% <span>{t('Peso corporal', 'Body weight')}</span></b><small className={harnessPct >= 70 && harnessPct <= 80 ? '' : 'warn'}>{harnessPct >= 70 && harnessPct <= 80 ? t('Objetivo de carga alcanzado', 'Load goal reached') : t('Fuera del objetivo (70–80 %)', 'Outside the goal (70–80 %)')}</small></div></article>
      <article><i className="heart"><Icon name="corazon" size={20} /></i><div><small>{t('Frecuencia cardiaca actual', 'Current heart rate')}</small><b>{hr ?? '—'} <span>{t('LPM', 'BPM')}</span></b><small className={`tp-zone ${zone.cls}`}><i />{zone.label}</small></div></article>
    </div>

    <div className="tp-layout">
      <div className="tp-lists">{(filter === 'all' || filter === 'ared') && group('ared')}{(filter === 'all' || filter === 'cardio') && group('cardio')}</div>

      <article className="tp-active">
        <div className="tp-active-head"><span>{t('EJERCICIO ACTIVO', 'ACTIVE EXERCISE')}</span><small>{index + 1} / {list.length}</small></div>
        <h3>{routine.name}</h3>
        <p>{routine.cue}</p>
        <div className="tp-stage">
          <i className="tp-axis" />
          <TrainingFigure exercise={routine.id} f={usesSensor && setActive ? (angle ?? 0) / routine.goal : setActive ? guideF : 0.6} cycle={cycle} />
          <div className="active-muscles"><b><i />{t('Músculos activos', 'Active muscles')}</b><small>{routine.muscles}</small></div>
        </div>
        <div className={`tp-sensor ${imuLive && !demo ? 'real' : ''}`}>
          <span><i />{!usesSensor ? `${t('Sensor', 'Sensor')}: ${routine.sensor}` : demo ? t('Demostración · movimiento simulado', 'Demo · simulated movement') : `${routine.sensor} · ${neutral ? t('calibrado', 'calibrated') : t('sin calibrar', 'not calibrated')}`}</span>
          {usesSensor && imuLive && <button onClick={calibrate}>{t('Calibrar postura', 'Calibrate posture')}</button>}
          {usesSensor && <label><input type="checkbox" checked={demo} disabled={!imuLive} onChange={e => setDemoChoice(e.target.checked)} /> {t('Demo', 'Demo')}</label>}
        </div>

        <div className={`tp-interval ${phase}`}>
          <div>
            <small>{t('INTERVALO ACTUAL', 'CURRENT INTERVAL')} · {routine.sets > 1 ? t(`SERIE ${Math.min(setsDone + 1, routine.sets)} DE ${routine.sets}`, `SET ${Math.min(setsDone + 1, routine.sets)} OF ${routine.sets}`) : t('BLOQUE ÚNICO', 'SINGLE BLOCK')}</small>
            <b>{phase === 'set' && routine.reps ? `${reps.length}/${routine.reps}` : mmss(phase === 'idle' ? routine.rest || routine.minutes * 60 : clock)}</b>
            <span>{day.done[routine.id] ? t('Ejercicio completado', 'Exercise completed')
              : phase === 'rest' ? t('Descanso entre series', 'Rest between sets')
              : phase === 'set' ? (routine.reps ? `${t('repeticiones', 'reps')} · ${mmss(clock)}${angle != null ? ` · ${Math.round(angle)}° / ${routine.goal}°` : ''}${lastRep ? (lastRep.full ? t(' · rango completo', ' · full range') : t(' · sube un poco más', ' · go a bit higher')) : ''}` : t('Bloque en curso', 'Block in progress'))
              : routine.rest ? t('Descanso entre series', 'Rest between sets') : t('Duración del bloque', 'Block duration')}</span>
          </div>
          <button onClick={start}><svg viewBox="0 0 16 16">{setActive ? <path d="M5 3v10M11 3v10" /> : <path d="M5 3l8 5-8 5z" />}</svg>{setActive ? t('Pausar', 'Pause') : t('Iniciar', 'Start')}</button>
        </div>

        <div className="tp-loadctl">
          <div><small>{routine.id === 'cevis' ? t('NIVEL DE RESISTENCIA', 'RESISTANCE LEVEL') : routine.id === 'run' ? t('CARGA DEL ARNÉS', 'HARNESS LOAD') : t('CARGA RESISTIVA', 'RESISTIVE LOAD')}</small><b>{loadText(load)}</b></div>
          <button aria-label={t('Bajar carga', 'Lower load')} onClick={() => changeLoad(-1)}>−</button>
          <button aria-label={t('Subir carga', 'Raise load')} onClick={() => changeLoad(1)}>+</button>
        </div>
        <button className="tp-primary" onClick={registerSet} disabled={!!day.done[routine.id]}><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>{day.done[routine.id] ? t('Ejercicio completado', 'Exercise completed') : routine.sets > 1 ? t(`Serie registrada (${setsDone}/${routine.sets})`, `Set logged (${setsDone}/${routine.sets})`) : t('Bloque registrado', 'Block logged')}</button>
        <button className="tp-secondary" onClick={resetLoad} title={t('Vuelve a la carga prescrita', 'Back to the prescribed load')}><svg viewBox="0 0 16 16"><path d="M2 4h8M12 4h2M2 12h3M7 12h7M10 2v4M5 10v4" /></svg>{t('Ajustar carga (prescrita: ', 'Adjust load (prescribed: ')}{loadText(routine.load)})</button>
        <p className="tp-safety">{t('Detén el ejercicio si aparece dolor, mareo o dificultad para respirar.', 'Stop exercising if you feel pain, dizziness or shortness of breath.')}</p>
      </article>
    </div>
  </section>
}
