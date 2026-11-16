import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import type { Alert } from './health'
import type { AlertTracker } from './alertLog'
import { locale, t } from './i18n'

const legend = () => [
  { level: 1, title: t('Lo resuelves tú', 'Self-care'), text: t('Descanso, hidratación, respiración o ajustar el ejercicio. Vuelve a medir.', 'Rest, hydration, breathing or adjusting exercise. Measure again.') },
  { level: 2, title: t('Avisa al oficial médico', 'Tell the medical officer'), text: t('El cambio es mayor o se combinan varias señales. Lo revisa la tripulación.', 'The change is larger or several signals combine. The crew reviews it.') },
  { level: 3, title: t('Consulta con Tierra', 'Consult Earth'), text: t('Se genera un reporte prioritario para los médicos en Tierra.', 'A priority report is generated for the flight surgeons on Earth.') },
]
const linkLabel = (link: string) => link === 'Wellness' ? t('Ir a Bienestar', 'Go to Wellness') : link === 'EVA' ? t('Ver posición EVA', 'View EVA position') : t('Ir a Entrenamiento', 'Go to Training')

export function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return t(`${s} s`, `${s} s`)
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}
const hhmm = (ts: number) => new Date(ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })

/** Ordena: primero las no atendidas (por nivel), luego las atendidas, al final los recordatorios. */
export function sortAlerts(alerts: Alert[], tr: AlertTracker) {
  const rank = (a: Alert) => a.level === 0 ? -10 : tr.isAcked(a) ? a.level - 5 : a.level
  return [...alerts].sort((a, b) => rank(b) - rank(a))
}

/** Barra tipo semáforo arriba del panel: la alerta más importante y desde cuándo. */
export function AlertBar({ alerts, tracker, now, onShow }: { alerts: Alert[]; tracker: AlertTracker; now: number; onShow: (id?: string) => void }) {
  const active = alerts.filter(a => a.level >= 1)
  const pending = sortAlerts(active, tracker).filter(a => !tracker.isAcked(a))
  const top = pending[0]
  if (!active.length) return <section className="alert-bar ok" role="status">
    <Icon name="check-circulo" size={22} />
    <div><b>{t('Todo dentro de tu línea base', 'Everything within your baseline')}</b><p>{t('Sin alertas activas. STELLAR revisa tus señales cada 5 s.', 'No active alerts. STELLAR checks your signals every 5 s.')}</p></div>
  </section>
  if (!top) return <section className="alert-bar watch" role="status">
    <span className="lv l0">✓</span>
    <div><b>{t(`En seguimiento · ${active.length} alerta${active.length > 1 ? 's' : ''} atendida${active.length > 1 ? 's' : ''}`, `Monitoring · ${active.length} acknowledged alert${active.length > 1 ? 's' : ''}`)}</b><p>{t('Siguen activas, pero ya las marcaste como entendidas. Si suben de nivel volverán a destacarse.', 'Still active, but you marked them as understood. If they escalate they will stand out again.')}</p></div>
    <button onClick={() => onShow()}>{t('Ver', 'View')}</button>
  </section>
  const since = tracker.since(top.id)
  return <section className={`alert-bar l${top.level}`} role="alert">
    <span className={`lv l${top.level}`}>{top.level}</span>
    <div>
      <small>{top.level_title.toUpperCase()}{since ? ` · ${t('activa hace', 'active for')} ${ago(now - since)}` : ''}{pending.length > 1 ? ` · +${pending.length - 1} ${t('más', 'more')}` : ''}</small>
      <b>{top.title}</b>
      <p>{top.reason}</p>
    </div>
    <button onClick={() => onShow(top.id)}>{t('Qué hacer', 'What to do')}<Icon name="flecha-derecha" size={14} /></button>
  </section>
}

/** Lista de alertas activas (desplegables, con pasos para marcar) + historial de hoy. */
export function AlertCenter({ alerts, tracker, now, focus, onOpen }: { alerts: Alert[]; tracker: AlertTracker; now: number; focus: { id?: string; n: number }; onOpen: (screen: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [help, setHelp] = useState(false)
  const box = useRef<HTMLElement>(null)
  const sorted = sortAlerts(alerts, tracker)
  const active = sorted.filter(a => a.level >= 1)
  const reminders = sorted.filter(a => a.level === 0)

  // La barra de arriba o la campana piden mostrar una alerta: se abre y se hace scroll hasta aquí.
  useEffect(() => {
    if (!focus.n) return
    setOpen(focus.id ?? active.find(a => !tracker.isAcked(a))?.id ?? active[0]?.id ?? null)
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focus.n])

  const row = (a: Alert) => {
    const acked = tracker.isAcked(a), expanded = open === a.id
    const since = tracker.since(a.id)
    const done = tracker.checks[a.id] ?? []
    return <div key={a.id} className={`ac-item l${a.level} ${acked ? 'acked' : ''} ${expanded ? 'open' : ''}`}>
      <button className="ac-head" onClick={() => setOpen(expanded ? null : a.id)} aria-expanded={expanded}>
        <span className={`lv l${a.level}`}>{a.level || '•'}</span>
        <b>{a.title}</b>
        {acked && <em className="ac-ack">{t('Entendido', 'Understood')}</em>}
        <small>{a.level === 0 ? t('Recordatorio', 'Reminder') : since ? t(`hace ${ago(now - since)}`, `${ago(now - since)} ago`) : ''}</small>
        <Icon name="flecha-derecha" size={14} />
      </button>
      {expanded && <div className="ac-body">
        <p className="ac-why"><b>{t('Por qué', 'Why')}:</b> {a.reason}</p>
        {a.evidence.length > 0 && <div className="evidence">{a.evidence.map(e => <span key={e}>{e}</span>)}</div>}
        {a.actions.length > 0 && <>
          <b className="ac-label">{t('QUÉ HACER', 'WHAT TO DO')} · {done.length}/{a.actions.length}</b>
          <ul className="ac-steps">{a.actions.map((step, i) => <li key={step}><label className={done.includes(i) ? 'done' : ''}>
            <input type="checkbox" checked={done.includes(i)} onChange={() => tracker.toggleCheck(a.id, i)} />{step}</label></li>)}</ul>
        </>}
        <p className="ac-meta"><span>{t('Actúa', 'Who acts')}: <em>{a.who}</em></span><span><Icon name="cohete" size={12} /> {a.hazard}</span></p>
        <div className="ac-actions">
          {a.level >= 1 && (acked
            ? <button onClick={() => tracker.unack(a.id)}>{t('Volver a destacar', 'Highlight again')}</button>
            : <button className="primary" onClick={() => { tracker.ack(a); setOpen(null) }}>{t('Entendido', 'Understood')}</button>)}
          {a.link && <button onClick={() => onOpen(a.link!)}>{linkLabel(a.link)}<Icon name="flecha-derecha" size={13} /></button>}
        </div>
      </div>}
    </div>
  }

  const log = [...tracker.log].reverse()
  return <section className="alert-center" ref={box}>
    <article className="panel ac-list">
      <div className="panel-head"><div><span>{t('ALERTAS ACTIVAS', 'ACTIVE ALERTS')} ({active.length})</span><h3>{t('Qué cambió y qué hacer', 'What changed and what to do')}</h3></div>
        <button className="ac-help" onClick={() => setHelp(h => !h)} aria-expanded={help} title={t('Qué significan los niveles', 'What the levels mean')}>?</button></div>
      {help && <div className="ac-legend">{legend().map(l => <div key={l.level}><span className={`lv l${l.level}`}>{l.level}</span><p><b>{l.title}.</b> {l.text}</p></div>)}</div>}
      {active.length === 0 && <p className="ac-empty"><Icon name="check-circulo" size={18} /> {t('Sin alertas activas: tus señales están dentro de tu propia línea base.', 'No active alerts: your signals are within your own baseline.')}</p>}
      {active.map(row)}
      {reminders.length > 0 && <><span className="ac-sub">{t('RECORDATORIOS', 'REMINDERS')}</span>{reminders.map(row)}</>}
      <p className="disclaimer">{t('Reglas simples y transparentes con rangos de referencia generales. Prototipo educativo: no es un dispositivo médico.', 'Simple, transparent rules with general reference ranges. Educational prototype: not a medical device.')}</p>
    </article>
    <article className="panel ac-log">
      <div className="panel-head"><div><span>{t('HOY', 'TODAY')}</span><h3>{t('Historial de alertas', 'Alert history')}</h3></div></div>
      {log.length === 0 ? <p className="ac-empty">{t('Sin alertas hoy.', 'No alerts today.')}</p>
        : <ol>{log.map(e => <li key={e.key} className={e.end == null ? 'live' : ''}>
          <time>{hhmm(e.start)}</time><i className={`ac-dot l${e.maxLevel}`} />
          <div><b>{e.title}</b><small>{e.end == null
            ? (tracker.acks[e.id] != null ? t(`activa · atendida · ${ago(now - e.start)}`, `active · acknowledged · ${ago(now - e.start)}`) : t(`activa · ${ago(now - e.start)}`, `active · ${ago(now - e.start)}`))
            : t(`resuelta · duró ${ago(e.end - e.start)}`, `resolved · lasted ${ago(e.end - e.start)}`)}{e.maxLevel > 1 ? ` · ${t('nivel máx.', 'max level')} ${e.maxLevel}` : ''}</small></div>
        </li>)}</ol>}
      <small className="ac-note">{t('Guardado en este navegador; se reinicia cada día.', 'Saved in this browser; resets every day.')}</small>
    </article>
  </section>
}
