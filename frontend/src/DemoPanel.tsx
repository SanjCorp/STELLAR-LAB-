import { useEffect, useRef, useState } from 'react'
import { apiFetch } from './api'
import Icon from './Icon'
import { t } from './i18n'
import type { CrewProfile } from './profiles'

type DemoItem = { astronaut_id: string; scenario: string; started: number; intensity: number; live_hardware: boolean }

const scenarios = () => [
  { id: 'fatigue', icon: '☾', title: t('Fatiga', 'Fatigue'), text: t('Pulso más alto + durmió 4,5 h', 'Higher heart rate + slept 4.5 h') },
  { id: 'stress', icon: '≋', title: t('Estrés', 'Stress'), text: t('Pulso y respiración altos + tensión 5/5', 'High heart rate and breathing + stress 5/5') },
  { id: 'fever', icon: '🌡', title: t('Fiebre', 'Fever'), text: t('38,6 °C + pulso alto → nivel 3 y reporte a Tierra', '38.6 °C + high heart rate → level 3 and Earth report') },
  { id: 'leads_off', icon: '⚡', title: t('Electrodos sueltos', 'Loose electrodes'), text: t('Lectura poco confiable', 'Unreliable reading') },
  { id: 'eva_far', icon: '🚀', title: t('Lejos de la estación', 'Far from station'), text: t('La EVA pasa de 25 m (cable)', 'EVA goes beyond 25 m (tether)') },
  { id: 'solar_storm', icon: '☀', title: t('Tormenta solar', 'Solar storm'), text: t('La radiación de la nave sube a ~150 µSv/h, 9× el máximo (vista EVA)', 'Ship radiation rises to ~150 µSv/h, 9× the maximum (EVA view)') },
]

/** Botón "Demo" de la barra superior: provoca cambios en la SIMULACIÓN para mostrar las alertas. */
export default function DemoPanel({ crew, current, onChange }: { crew: CrewProfile[]; current: string; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState(crew.some(c => c.id === current) ? current : crew[0].id)
  const [items, setItems] = useState<DemoItem[]>([])
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => { if (crew.some(c => c.id === current)) setTarget(current) }, [current])
  const load = async () => { try { const r = await apiFetch('/api/demo'); if (r.ok) setItems((await r.json()).items) } catch { /* sin cambios */ } }
  useEffect(() => { load(); const id = window.setInterval(load, open ? 2000 : 8000); return () => window.clearInterval(id) }, [open])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close)
  }, [open])

  const send = async (body: object) => {
    setBusy(true)
    try { const r = await apiFetch('/api/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (r.ok) setItems((await r.json()).items); onChange() }
    finally { setBusy(false) }
  }
  const active = items.find(i => i.astronaut_id === target)
  const name = (id: string) => crew.find(c => c.id === id)?.shortName ?? id
  const label = (id: string) => scenarios().find(s => s.id === id)?.title ?? id

  return <div className="demo-wrap" ref={box}>
    <button className={`demo-btn ${items.length ? 'on' : ''}`} onClick={() => setOpen(o => !o)} aria-expanded={open}><Icon name="destello-ia" size={16} />Demo{items.length > 0 && <em>{items.length}</em>}</button>
    {open && <div className="demo-pop" role="dialog" aria-label={t('Escenarios de demostración', 'Demo scenarios')}>
      <b>{t('ESCENARIOS DE DEMOSTRACIÓN', 'DEMO SCENARIOS')}</b>
      <p>{t('Cambian solo la simulación, poco a poco en 30 s. Nunca alteran los datos reales del ESP32.', 'They only change the simulation, gradually over 30 s. They never alter real ESP32 data.')}</p>
      <div className="demo-crew">{crew.map(c => <button key={c.id} className={target === c.id ? 'on' : ''} onClick={() => setTarget(c.id)}>{c.shortName}{items.some(i => i.astronaut_id === c.id) && <i />}</button>)}</div>
      <div className="demo-list">{scenarios().map(s => <button key={s.id} disabled={busy} className={active?.scenario === s.id ? 'on' : ''} onClick={() => send({ astronaut_id: target, scenario: s.id })}>
        <span>{s.icon}</span><div><b>{s.title}</b><small>{s.text}</small></div></button>)}</div>
      {active && <div className="demo-status">
        <div><b>{name(active.astronaut_id)} · {label(active.scenario)}</b><small>{Math.round(active.intensity * 100)}%</small></div>
        <i><em style={{ width: `${active.intensity * 100}%` }} /></i>
        {active.live_hardware && <p>{t('Este perfil recibe datos reales del ESP32 ahora: el escenario se verá cuando pase a simulación.', 'This profile is receiving real ESP32 data now: the scenario shows once it falls back to simulation.')}</p>}
      </div>}
      <div className="demo-actions">
        <button disabled={busy || !active} onClick={() => send({ astronaut_id: target, scenario: null })}>{t(`Volver a normal (${name(target)})`, `Back to normal (${name(target)})`)}</button>
        {items.length > 1 && <button disabled={busy} onClick={() => send({})}>{t('Quitar todos', 'Clear all')}</button>}
      </div>
      <small className="demo-foot">{t('Las alertas aparecen en ~20 s y algunas suben de nivel tras 1 min. Si el escenario dura más de 10 min, la línea base se adapta.', 'Alerts appear in ~20 s and some escalate after 1 min. If a scenario lasts over 10 min, the baseline adapts.')}</small>
    </div>}
  </div>
}
