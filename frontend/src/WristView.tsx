import { useEffect, useRef, useState } from 'react'
import { apiFetch } from './api'
import { levelInfo, type Alert, type Baseline, type Vitals } from './health'
import { missionDay, nodeTag, t } from './i18n'
import { usePositionPrefer } from './phoneTracker'
import { fallbackText, PhoneControls, positionUrl, SourceSwitch, type Position } from './PositionSource'
import type { CrewProfile } from './profiles'
import type { Sample } from './charts'

/*
 * Pantalla de MUÑECA: el celular en horizontal, sujeto a la manga del traje.
 * No es la página "achicada": solo lo que el astronauta necesita de un vistazo
 * (pulso, respiración, estado/alerta con la acción, y dónde está respecto a la cápsula).
 * Letras grandes, alto contraste, todo en una pantalla sin desplazarse.
 */

const ZONE_COLOR = { cabina: '#45D6C5', cerca: '#35C99A', atencion: '#F2B84B', fuera: '#F16F78' }
const zoneLabel = (z?: Position['zone']) => ({
  cabina: t('DENTRO DE LA CABINA', 'INSIDE THE CABIN'),
  cerca: t('FUERA DE LA CABINA', 'OUTSIDE THE CABIN'),
  atencion: t('CERCA DEL LÍMITE DEL CABLE', 'NEAR TETHER LIMIT'),
  fuera: t('FUERA DE RANGO · REGRESA', 'OUT OF RANGE · RETURN'),
})[z ?? 'cabina']
const sourceShort = (s?: Position['source']) => s === 'hardware' ? 'MPU6050' : s === 'phone' ? t('CELULAR', 'PHONE') : 'SIM'

/** Vista desde arriba: círculo de la cabina (2 m), anillo del cable y el astronauta. */
function Radar({ pos }: { pos: Position | null }) {
  const cabin = pos?.cabin_m ?? 2
  const dist = pos?.distance_m ?? 0
  // Metros hasta el borde del radar: se acerca o aleja según lo lejos que estés.
  const range = Math.max(cabin * 2.2, Math.min(pos?.tether_m ?? 25, dist * 1.6), dist * 1.1)
  const k = 46 / range
  const far = range > cabin * 2.2
  const color = ZONE_COLOR[pos?.zone ?? 'cabina']
  const trail = (pos?.trail ?? []).slice(-40).map(([x, y]) => `${(x * k).toFixed(1)},${(-y * k).toFixed(1)}`).join(' ')
  const x = Math.max(-48, Math.min(48, (pos?.x ?? 0) * k)), y = Math.max(-48, Math.min(48, -(pos?.y ?? 0) * k))
  return <svg viewBox="-50 -50 100 100" className="wr-radar" aria-hidden>
    <circle r="48" className="wr-radar-bg" />
    {far && (pos?.safe_m ?? 15) * k <= 48 && <circle r={(pos?.safe_m ?? 15) * k} className="wr-ring" />}
    {far && (pos?.tether_m ?? 25) * k <= 48 && <circle r={(pos?.tether_m ?? 25) * k} className="wr-ring tether" />}
    <circle r={cabin * k} className="wr-cabin" />
    <line x1="-48" x2="48" y1="0" y2="0" className="wr-axis" /><line y1="-48" y2="48" x1="0" x2="0" className="wr-axis" />
    {trail && <polyline points={trail} className="wr-trail" style={{ stroke: color }} />}
    <circle cx={x} cy={y} r="4.2" fill={color} className="wr-dot" />
    <text y="-40" className="wr-radar-txt">{far ? `${Math.round(range)} m` : `${cabin} m`}</text>
  </svg>
}

export default function WristView({ profile, sample, baseline, alerts, vitals, connected, onExit }: {
  profile: CrewProfile; sample: Sample | null; baseline: Baseline | null; alerts: Alert[]; vitals: Vitals | null; connected: boolean; onExit: () => void
}) {
  const [pos, setPos] = useState<Position | null>(null)
  const [prefer, setPrefer] = usePositionPrefer()
  const [clock, setClock] = useState(() => new Date())
  const [full, setFull] = useState(false)
  const lastLevel = useRef(0)

  useEffect(() => { const id = window.setInterval(() => setClock(new Date()), 1000); return () => window.clearInterval(id) }, [])

  useEffect(() => {
    let alive = true
    const load = async () => {
      try { const r = await apiFetch(positionUrl(profile.id, prefer, 60)); if (r.ok && alive) setPos(await r.json()) } catch { /* sin cambios */ }
    }
    load(); const id = window.setInterval(load, 1000)
    return () => { alive = false; window.clearInterval(id) }
  }, [profile.id, prefer])

  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const active = alerts.filter(a => a.level >= 1).sort((a, b) => b.level - a.level)
  const top = active[0]
  const maxLevel = top?.level ?? 0
  // Vibra si sube el nivel de alerta (útil con el celular en la muñeca).
  useEffect(() => {
    if (maxLevel >= 2 && maxLevel > lastLevel.current) navigator.vibrate?.(maxLevel >= 3 ? [300, 120, 300, 120, 300] : [250, 120, 250])
    lastLevel.current = maxLevel
  }, [maxLevel])

  const goFull = async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return }
      await document.documentElement.requestFullscreen()
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
      await o.lock?.('landscape').catch(() => {})
    } catch { /* el iPhone no deja pantalla completa en el navegador */ }
  }

  const live = sample?.source === 'hardware'
  const leadsOff = !!sample?.leads_off
  const hr = leadsOff ? null : sample?.heart_rate_bpm ?? null
  const rr = leadsOff ? null : sample?.respiration_rate_bpm ?? null
  const hrB = baseline?.signals?.heart_rate_bpm, rrB = baseline?.signals?.respiration_rate_bpm
  const tone = (lv?: string) => levelInfo(lv as never).tone
  const delta = (b?: typeof hrB) => b?.delta != null && b.center != null ? `${b.delta > 0 ? '+' : ''}${Math.round(b.delta)} ${t('vs tu base', 'vs your base')}` : b ? levelInfo(b.level).label : t('Calibrando…', 'Calibrating…')
  const statusTone = maxLevel >= 3 ? 'red' : maxLevel === 2 ? 'amber' : leadsOff ? 'gray' : tone(baseline?.level)
  const statusTitle = maxLevel >= 3 ? t('NIVEL 3 · CRÍTICO', 'LEVEL 3 · CRITICAL') : maxLevel === 2 ? t('NIVEL 2 · ATENCIÓN', 'LEVEL 2 · ATTENTION')
    : maxLevel === 1 ? t('NIVEL 1 · AUTOCUIDADO', 'LEVEL 1 · SELF-CARE') : leadsOff ? t('REVISA ELECTRODOS', 'CHECK ELECTRODES') : levelInfo(baseline?.level).short
  const bp = vitals?.latest_bp, temp = vitals?.latest_temp
  const zoneColor = ZONE_COLOR[pos?.zone ?? 'cabina']
  const fb = fallbackText(pos)

  return <div className={`wrist tone-${statusTone}`}>
    <div className="wr-top">
      <span className={`wr-link ${connected ? (live ? 'ok' : 'sim') : 'off'}`}><i />{connected ? nodeTag(profile.node, live) : t('SIN API', 'NO API')}</span>
      <b className="wr-name">{profile.shortName.toUpperCase()}</b>
      <span className="wr-meta">{t('DÍA', 'DAY')} {missionDay()} · {clock.toISOString().slice(11, 16)} UTC</span>
      <span className="wr-spacer" />
      {sample?.battery_pct != null && live && <span className="wr-meta">{t('NODO', 'NODE')} {sample.battery_pct}%</span>}
      <button onClick={goFull} aria-label={t('Pantalla completa', 'Full screen')}>{full ? '⤡' : '⤢'}</button>
      <button onClick={onExit} aria-label={t('Salir del modo muñeca', 'Exit wrist mode')}>✕</button>
    </div>

    <div className="wr-grid">
      <div className="wr-vitals">
        <div className={`wr-hr tone-${leadsOff ? 'gray' : tone(hrB?.level)}`}>
          <span>{t('PULSO', 'HEART')}</span>
          <strong>{hr != null ? Math.round(hr) : '—'}<small>{t('lpm', 'bpm')}</small></strong>
          <em>{leadsOff ? t('Electrodos sueltos', 'Leads off') : delta(hrB)}</em>
        </div>
        <div className={`wr-rr tone-${leadsOff ? 'gray' : tone(rrB?.level)}`}>
          <span>{t('RESP.', 'BREATH')}</span>
          <strong>{rr != null ? rr.toFixed(0) : '—'}<small>{t('rpm', 'br/m')}</small></strong>
        </div>
        <div className="wr-small">
          <span>{temp?.temperature_c != null ? `${temp.temperature_c.toFixed(1)} °C` : '— °C'}</span>
          <span>{bp ? `${bp.systolic_mmhg}/${bp.diastolic_mmhg ?? '—'}` : '—/—'} <small>mmHg</small></span>
        </div>
      </div>

      <div className={`wr-status tone-${statusTone}`}>
        <span>STELLAR AI</span>
        <strong>{statusTitle}</strong>
        {top ? <>
          <p className="wr-why">{top.title}</p>
          <p className="wr-do"><b>{t('HAZ', 'DO')}:</b> {top.actions[0]}</p>
          {active.length > 1 && <small>+{active.length - 1} {t('alerta(s) más', 'more alert(s)')}</small>}
        </> : <p className="wr-why">{leadsOff ? t('Ajusta los electrodos del pecho: la lectura no es confiable.', 'Adjust the chest electrodes: the reading is unreliable.')
          : baseline?.level === 'calibrating' ? t('Aprendiendo tu normal…', 'Learning your normal…') : t('Todo dentro de tu normal.', 'All within your normal.')}</p>}
      </div>

      <div className="wr-pos" style={{ borderColor: zoneColor }}>
        <Radar pos={pos} />
        <div className="wr-pos-txt">
          <strong style={{ color: zoneColor }}>{pos ? pos.distance_m.toFixed(1) : '—'}<small> m</small></strong>
          <span style={{ color: zoneColor }}>{zoneLabel(pos?.zone)}</span>
          <em>{sourceShort(pos?.source)}{pos?.steps != null ? ` · ${pos.steps} ${t('pasos', 'steps')}` : ''}</em>
        </div>
        <div className="wr-pos-src">
          <SourceSwitch prefer={prefer} onChange={setPrefer} pos={pos} compact />
          {fb && <small className="wr-fb">{fb}</small>}
        </div>
      </div>
    </div>

    <div className="wr-foot">
      <PhoneControls astronautId={profile.id} compact />
      <span className="wr-spacer" />
      <small>{t('Prototipo educativo · no es un dispositivo médico', 'Educational prototype · not a medical device')}</small>
    </div>
    <div className="wr-rotate">{t('Gira el celular en horizontal', 'Turn the phone sideways')} ⟲</div>
  </div>
}
