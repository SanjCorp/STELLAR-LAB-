import { useEffect, useMemo, useState } from 'react'
import type { CrewProfile } from './profiles'
import { apiFetch } from './api'

type CrewMetric = {
  astronaut_id: string
  source: 'simulation' | 'hardware'
  heart_rate_bpm: number | null
  respiration_rate_bpm: number | null
  movement_score: number
  recovery_score: number
  status: 'Stable' | 'Observe'
  received_at: string
}

const fallback: Record<string, CrewMetric> = {
  bresnik: { astronaut_id: 'bresnik', source: 'simulation', heart_rate_bpm: 71, respiration_rate_bpm: 15.4, movement_score: 82, recovery_score: 88, status: 'Stable', received_at: '' },
  parmitano: { astronaut_id: 'parmitano', source: 'simulation', heart_rate_bpm: 68, respiration_rate_bpm: 14.8, movement_score: 91, recovery_score: 92, status: 'Stable', received_at: '' },
  douglas: { astronaut_id: 'douglas', source: 'simulation', heart_rate_bpm: 76, respiration_rate_bpm: 17.2, movement_score: 74, recovery_score: 80, status: 'Observe', received_at: '' },
  rubio: { astronaut_id: 'rubio', source: 'simulation', heart_rate_bpm: 70, respiration_rate_bpm: 15.9, movement_score: 86, recovery_score: 89, status: 'Stable', received_at: '' },
}

export default function CrewCommand({ crew }: { crew: CrewProfile[] }) {
  const [selected, setSelected] = useState(crew[0].id)
  const [metrics, setMetrics] = useState<Record<string, CrewMetric>>(fallback)

  useEffect(() => {
    let alive = true
    const refresh = async () => {
      try {
        const response = await apiFetch('/api/crew')
        if (!response.ok) throw new Error('Crew API unavailable')
        const payload = await response.json() as { items: CrewMetric[] }
        if (alive) setMetrics(current => ({ ...current, ...Object.fromEntries(payload.items.map(item => [item.astronaut_id, item])) }))
      } catch { /* conserva la última lectura visible */ }
    }
    refresh()
    const timer = window.setInterval(refresh, 1000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  const profile = crew.find(item => item.id === selected) ?? crew[0]
  const metric = metrics[profile.id] ?? fallback[profile.id]
  const stableCount = useMemo(() => crew.filter(member => metrics[member.id]?.status === 'Stable').length, [crew, metrics])

  return <section className="command-page">
    <div className="command-heading"><div><span>COMMANDER ACCESS · MONITORING ONLY</span><h2>Estado de la tripulación</h2><p>Vista central alimentada por cada ESP32. Este módulo no modifica rutinas, registros personales ni configuraciones.</p></div><div className="crew-summary"><b>{crew.length}</b><span>tripulantes</span><b>{stableCount}</b><span>estables</span><b>{crew.length - stableCount}</b><span>observar</span></div></div>
    <div className="crew-status-grid">
      {crew.map(member => { const data = metrics[member.id] ?? fallback[member.id]; return <button key={member.id} className={selected === member.id ? 'selected' : ''} onClick={() => setSelected(member.id)} style={{'--profile-accent': member.accent} as React.CSSProperties}>
        {member.photo ? <img className="mini-portrait" src={member.photo} alt="" /> : <div className="mini-portrait">{member.initials}</div>}<div><strong>{member.name}</strong><span>{member.role} · {data.source === 'hardware' ? 'ESP32' : 'SIM'}</span></div><em className={data.status === 'Stable' ? '' : 'watch'}><i/>{data.status}</em>
      </button>})}
    </div>
    <div className="command-detail">
      <article className="crew-vitals"><div className="detail-title">{profile.photo ? <img className="detail-avatar" src={profile.photo} alt="" /> : <div className="detail-avatar">{profile.initials}</div>}<div><span>SELECTED CREW MEMBER</span><h3>{profile.name}</h3><p>{profile.role} · {profile.agency} · {metric.source === 'hardware' ? 'LIVE ESP32' : 'SIMULATION'}</p></div><b>MISSION DAY 042</b></div>
        <div className="detail-metrics"><div><span>Heart rate</span><b>{metric.heart_rate_bpm ?? '—'}<small>bpm</small></b><i style={{width:`${metric.heart_rate_bpm ?? 0}%`}}/></div><div><span>Respiration</span><b>{metric.respiration_rate_bpm?.toFixed(1) ?? '—'}<small>rpm</small></b><i style={{width:`${(metric.respiration_rate_bpm ?? 0) * 4}%`}}/></div><div><span>Movement score</span><b>{metric.movement_score}<small>%</small></b><i style={{width:`${metric.movement_score}%`}}/></div><div><span>Recovery index</span><b>{metric.recovery_score}<small>%</small></b><i style={{width:`${metric.recovery_score}%`}}/></div></div>
      </article>
      <aside className="command-analysis"><span>STELLAR ANALYSIS</span><h3>{metric.status === 'Stable' ? 'No relevant deviations' : 'Recovery trend requires observation'}</h3><p>{metric.status === 'Stable' ? 'Cardiac, respiratory and movement indicators remain within the demonstration baseline.' : 'One or more readings are outside the personal demonstration baseline. Re-evaluate after the scheduled recovery period.'}</p><ul><li><i/>Telemetry {metric.source === 'hardware' ? 'received from ESP32' : 'simulated locally'}</li><li><i/>Respiratory signal active</li><li><i className={metric.status === 'Stable' ? '' : 'watch'}/>{metric.status === 'Stable' ? 'Routine completed' : 'Follow-up pending'}</li></ul><div>READ-ONLY CREW VIEW</div></aside>
    </div>
  </section>
}
