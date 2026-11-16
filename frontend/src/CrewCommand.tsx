import { useEffect, useMemo, useState } from 'react'
import type { CrewProfile } from './profiles'
import { apiFetch } from './api'
import { missionDay, nodeTag, roleLabel, t } from './i18n'

type CrewMetric = {
  astronaut_id: string
  source: 'simulation' | 'hardware'
  heart_rate_bpm: number | null
  respiration_rate_bpm: number | null
  movement_score: number
  recovery_score: number
  status: 'Stable' | 'Observe'
  level?: string
  reasons?: string[]
  received_at: string
}

const fallback: Record<string, CrewMetric> = {
  bresnik: { astronaut_id: 'bresnik', source: 'simulation', heart_rate_bpm: 71, respiration_rate_bpm: 15.4, movement_score: 82, recovery_score: 88, status: 'Stable', received_at: '' },
  parmitano: { astronaut_id: 'parmitano', source: 'simulation', heart_rate_bpm: 68, respiration_rate_bpm: 14.8, movement_score: 91, recovery_score: 92, status: 'Stable', received_at: '' },
  douglas: { astronaut_id: 'douglas', source: 'simulation', heart_rate_bpm: 76, respiration_rate_bpm: 17.2, movement_score: 74, recovery_score: 80, status: 'Stable', received_at: '' },
  rubio: { astronaut_id: 'rubio', source: 'simulation', heart_rate_bpm: 70, respiration_rate_bpm: 15.9, movement_score: 86, recovery_score: 89, status: 'Stable', received_at: '' },
}

const statusLabel = (s: CrewMetric['status']) => s === 'Stable' ? t('Estable', 'Stable') : t('Observar', 'Observe')

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
  const stable = metric.status === 'Stable'

  return <section className="command-page">
    <div className="command-heading"><div><span>{t('ACCESO COMANDANTE · SOLO LECTURA', 'COMMANDER ACCESS · READ ONLY')}</span><h2>{t('Estado de la tripulación', 'Crew status')}</h2><p>{t('Vista central alimentada por cada ESP32. Este módulo no modifica rutinas, registros personales ni configuraciones.', 'Central view fed by each ESP32. This module does not change routines, personal records or settings.')}</p></div><div className="crew-summary"><b>{crew.length}</b><span>{t('tripulantes', 'crew')}</span><b>{stableCount}</b><span>{t('estables', 'stable')}</span><b>{crew.length - stableCount}</b><span>{t('observar', 'observe')}</span></div></div>
    <div className="crew-status-grid">
      {crew.map(member => { const data = metrics[member.id] ?? fallback[member.id]; return <button key={member.id} className={selected === member.id ? 'selected' : ''} onClick={() => setSelected(member.id)} style={{'--profile-accent': member.accent} as React.CSSProperties}>
        {member.photo ? <img className="mini-portrait" src={member.photo} alt="" /> : <div className="mini-portrait">{member.initials}</div>}<div><strong>{member.name}</strong><span>{roleLabel(member.role)} · {nodeTag(member.node, data.source === 'hardware')}</span></div><em className={data.status === 'Stable' ? '' : 'watch'}><i/>{statusLabel(data.status)}</em>
      </button>})}
    </div>
    <div className="command-detail">
      <article className="crew-vitals"><div className="detail-title">{profile.photo ? <img className="detail-avatar" src={profile.photo} alt="" /> : <div className="detail-avatar">{profile.initials}</div>}<div><span>{t('TRIPULANTE SELECCIONADO', 'SELECTED CREW MEMBER')}</span><h3>{profile.name}</h3><p>{roleLabel(profile.role)} · {profile.agency} · {metric.source === 'hardware' ? t(`NODO ${profile.node} EN VIVO`, `NODE ${profile.node} LIVE`) : t('SIMULACIÓN', 'SIMULATION')}</p></div><b>{t('DÍA DE MISIÓN', 'MISSION DAY')} {missionDay()}</b></div>
        <div className="detail-metrics"><div><span>{t('Frecuencia cardiaca', 'Heart rate')}</span><b>{metric.heart_rate_bpm ?? '—'}<small>{t('lpm', 'bpm')}</small></b><i style={{width:`${Math.min(100, metric.heart_rate_bpm ?? 0)}%`}}/></div><div><span>{t('Respiración', 'Breathing')}</span><b>{metric.respiration_rate_bpm?.toFixed(1) ?? '—'}<small>{t('rpm', 'br/min')}</small></b><i style={{width:`${Math.min(100, (metric.respiration_rate_bpm ?? 0) * 4)}%`}}/></div><div><span>{t('Movimiento', 'Movement')}</span><b>{metric.movement_score}<small>%</small></b><i style={{width:`${metric.movement_score}%`}}/></div><div><span>{t('Índice de recuperación', 'Recovery index')}</span><b>{metric.recovery_score}<small>%</small></b><i style={{width:`${metric.recovery_score}%`}}/></div></div>
      </article>
      <div className="command-analysis"><span>{t('ANÁLISIS STELLAR', 'STELLAR ANALYSIS')}</span><h3>{stable ? t('Sin desviaciones relevantes', 'No relevant deviations') : t('Conviene observar a este tripulante', 'This crew member needs observation')}</h3><p>{stable ? t('Pulso y respiración siguen dentro de la línea base personal de este tripulante (mediana de sus últimos 10 min).', 'Heart rate and breathing remain within this crew member’s personal baseline (median of the last 10 min).') : (metric.reasons?.length ? metric.reasons.join(' ') : t('Una o más lecturas están fuera de su línea base personal.', 'One or more readings are outside the personal baseline.')) + ' ' + t('Vuelve a evaluar tras el periodo de recuperación.', 'Re-evaluate after the recovery period.')}</p><ul><li><i/>{metric.source === 'hardware' ? t('Telemetría recibida del ESP32', 'Telemetry received from ESP32') : t('Telemetría simulada', 'Simulated telemetry')}</li><li><i/>{t('Señal respiratoria activa', 'Respiratory signal active')}</li><li><i className={stable ? '' : 'watch'}/>{stable ? t('Rutina completada', 'Routine completed') : t('Seguimiento pendiente', 'Follow-up pending')}</li></ul><div>{t('VISTA DE TRIPULACIÓN · SOLO LECTURA', 'READ-ONLY CREW VIEW')}</div></div>
    </div>
  </section>
}
