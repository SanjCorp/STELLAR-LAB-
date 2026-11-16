import { useEffect, useState } from 'react'
import { apiFetch } from './api'
import type { Checkin } from './health'
import { locale, t } from './i18n'

// Rangos de referencia GENERALES para explicar cada dato. No son un diagnóstico.
function sleepNote(h: number) { return h < 6 ? { tone: 'watch', text: t('Poco sueño · lo recomendado es 7–9 h', 'Little sleep · 7–9 h is recommended') } : h > 10 ? { tone: 'watch', text: t('Sueño muy largo · observa si hay fatiga', 'Very long sleep · watch for fatigue') } : { tone: '', text: t('Dentro de lo recomendado (7–9 h)', 'Within the recommended range (7–9 h)') } }
function glucoseNote(g: number) { return g < 70 ? { tone: 'alert', text: t('Baja (< 70 mg/dL): come algo con azúcar y vuelve a medir', 'Low (< 70 mg/dL): eat something sugary and measure again') } : g > 180 ? { tone: 'alert', text: t('Alta (> 180 mg/dL): informa al oficial médico', 'High (> 180 mg/dL): tell the medical officer') } : g > 140 ? { tone: 'watch', text: t('Algo alta (> 140 mg/dL): revisa cuándo comiste', 'Slightly high (> 140 mg/dL): check when you ate') } : { tone: '', text: t('Dentro del rango de referencia (70–140 mg/dL)', 'Within the reference range (70–140 mg/dL)') } }
function bpNote(s: number, d: number) { return s >= 140 || d >= 90 ? { tone: 'alert', text: t('Alta (≥ 140/90)', 'High (≥ 140/90)') } : s >= 130 || d >= 80 ? { tone: 'watch', text: t('Elevada (≥ 130/80)', 'Elevated (≥ 130/80)') } : s < 90 || d < 60 ? { tone: 'watch', text: t('Baja (< 90/60)', 'Low (< 90/60)') } : { tone: '', text: t('Normal (< 130/80)', 'Normal (< 130/80)') } }
function tempNote(v: number) { return v >= 38 ? { tone: 'alert', text: t('Fiebre (≥ 38 °C)', 'Fever (≥ 38 °C)') } : v >= 37.3 ? { tone: 'watch', text: t('Algo elevada (≥ 37,3 °C)', 'Slightly high (≥ 37.3 °C)') } : v < 35.5 ? { tone: 'watch', text: t('Baja (< 35,5 °C)', 'Low (< 35.5 °C)') } : { tone: '', text: t('Normal (36–37,2 °C)', 'Normal (36–37.2 °C)') } }

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()
const num = (v: string) => v.trim() === '' ? null : Number(v.replace(',', '.'))
const ok = (v: number | null): v is number => v != null && !Number.isNaN(v)

export default function WellnessCheck({ astronautId }: { astronautId: string }) {
  const [sleep, setSleep] = useState(7.5)
  const [mood, setMood] = useState(3)
  const [stress, setStress] = useState(2)
  const [glucose, setGlucose] = useState('')
  const [sys, setSys] = useState('')
  const [dia, setDia] = useState('')
  const [temp, setTemp] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [storage, setStorage] = useState<string>('')
  const [history, setHistory] = useState<Checkin[]>([])

  const load = async () => {
    try {
      const res = await apiFetch(`/api/checkins?astronaut_id=${astronautId}&days=7`)
      if (res.ok) { const data = await res.json(); setHistory(data.items); setStorage(data.storage) }
    } catch { /* sin conexión: se mantiene lo último */ }
  }
  useEffect(() => { load() }, [astronautId])

  const touch = () => { if (status !== 'idle') setStatus('idle') }
  const glucoseValue = num(glucose), sysValue = num(sys), diaValue = num(dia), tempValue = num(temp)

  const save = async () => {
    setStatus('saving')
    try {
      const res = await apiFetch('/api/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        astronaut_id: astronautId, sleep_hours: sleep, mood, stress,
        glucose_mg_dl: ok(glucoseValue) ? glucoseValue : null, systolic_mmhg: ok(sysValue) ? sysValue : null,
        diastolic_mmhg: ok(diaValue) ? diaValue : null, temperature_c: ok(tempValue) ? tempValue : null, notes: notes.trim() || null,
      }) })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json(); setStorage(data.storage); setStatus('saved'); setGlucose(''); setSys(''); setDia(''); setTemp(''); setNotes('')
      load()
    } catch { setStatus('error') }
  }

  const today = history.filter(c => isToday(c.created_at))
  const reminders = [
    !today.length && t('Completa tu chequeo diario (sueño y ánimo).', 'Complete your daily check-in (sleep and mood).'),
    !today.some(c => c.glucose_mg_dl != null) && t('Mídete la glucosa y anótala aquí.', 'Measure your glucose and log it here.'),
    !today.some(c => c.systolic_mmhg != null) && t('Opcional: anota tu presión si tienes el tensiómetro a mano (si no, se usa la medición automática).', 'Optional: log your blood pressure if you have the cuff at hand (otherwise the automatic reading is used).'),
  ].filter(Boolean) as string[]

  const concern = stress >= 4 || mood <= 2 || sleep < 6 || (ok(glucoseValue) && (glucoseValue < 70 || glucoseValue > 180)) || (ok(tempValue) && tempValue >= 38)
  const recent = [...history].reverse().slice(-7)
  const when = (iso: string) => new Date(iso).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return <section className="wellness-page">
    <div className="wellness-heading"><span>{t('SALUD CONDUCTUAL · CHEQUEO DIARIO', 'BEHAVIORAL HEALTH · DAILY CHECK-IN')}</span><h2>{t('Bienestar de la tripulación', 'Crew wellness')}</h2><p>{t('Un registro breve cada día ayuda a reconocer cambios por aislamiento, carga de trabajo, sueño y recuperación. Los rangos son de referencia general, no un diagnóstico.', 'A short daily log helps spot changes from isolation, workload, sleep and recovery. Ranges are general references, not a diagnosis.')}</p></div>

    {reminders.length > 0 && <div className="reminder-strip"><b>◷ {t('RECORDATORIOS DE HOY', 'TODAY’S REMINDERS')}</b>{reminders.map(r => <span key={r}>{r}</span>)}</div>}

    <div className="wellness-grid">
      <article className="checkin-panel"><span>{t('REGISTRO DIARIO · MANUAL', 'DAILY LOG · MANUAL')}</span><h3>{t('¿Cómo te sientes hoy?', 'How do you feel today?')}</h3>
        <label>{t('Horas de sueño', 'Hours of sleep')} <b>{sleep.toFixed(1)} h</b><input type="range" min="0" max="12" step="0.5" value={sleep} onChange={e => { setSleep(Number(e.target.value)); touch() }}/></label><p className={`field-note ${sleepNote(sleep).tone}`}>{sleepNote(sleep).text}</p>
        <label>{t('Estado de ánimo', 'Mood')} <b>{mood}/5</b><input type="range" min="1" max="5" value={mood} onChange={e => { setMood(Number(e.target.value)); touch() }}/></label><div className="scale"><span>{t('Muy bajo', 'Very low')}</span><span>{t('Estable', 'Steady')}</span><span>{t('Muy bien', 'Very good')}</span></div>
        <label>{t('Nivel de tensión', 'Stress level')} <b>{stress}/5</b><input type="range" min="1" max="5" value={stress} onChange={e => { setStress(Number(e.target.value)); touch() }}/></label><div className="scale"><span>{t('Bajo', 'Low')}</span><span>{t('Moderado', 'Moderate')}</span><span>{t('Alto', 'High')}</span></div>

        <div className="manual-grid">
          <label className="num-field">{t('Glucosa', 'Glucose')} <small>mg/dL</small><input inputMode="decimal" placeholder={t('ej. 95', 'e.g. 95')} value={glucose} onChange={e => { setGlucose(e.target.value); touch() }}/></label>
          <label className="num-field">{t('Presión', 'Pressure')} <small>{t('sistólica', 'systolic')}</small><input inputMode="numeric" placeholder={t('ej. 118', 'e.g. 118')} value={sys} onChange={e => { setSys(e.target.value); touch() }}/></label>
          <label className="num-field">{t('Presión', 'Pressure')} <small>{t('diastólica', 'diastolic')}</small><input inputMode="numeric" placeholder={t('ej. 76', 'e.g. 76')} value={dia} onChange={e => { setDia(e.target.value); touch() }}/></label>
          <label className="num-field">{t('Temperatura', 'Temperature')} <small>°C</small><input inputMode="decimal" placeholder={t('ej. 36.6', 'e.g. 36.6')} value={temp} onChange={e => { setTemp(e.target.value); touch() }}/></label>
        </div>
        {ok(glucoseValue) && <p className={`field-note ${glucoseNote(glucoseValue).tone}`}>{t('Glucosa', 'Glucose')}: {glucoseNote(glucoseValue).text}</p>}
        {ok(sysValue) && ok(diaValue) && <p className={`field-note ${bpNote(sysValue, diaValue).tone}`}>{t('Presión', 'Blood pressure')}: {bpNote(sysValue, diaValue).text}</p>}
        {ok(tempValue) && <p className={`field-note ${tempNote(tempValue).tone}`}>{t('Temperatura', 'Temperature')}: {tempNote(tempValue).text}</p>}
        <label className="notes-field">{t('Notas (opcional)', 'Notes (optional)')}<textarea maxLength={500} rows={2} value={notes} onChange={e => { setNotes(e.target.value); touch() }} placeholder={t('¿Algo que quieras registrar?', 'Anything you want to log?')}/></label>

        <button className="primary-action" disabled={status === 'saving'} onClick={save}>{status === 'saving' ? t('Guardando…', 'Saving…') : status === 'saved' ? t('Chequeo guardado ✓', 'Check-in saved ✓') : t('Guardar chequeo', 'Save check-in')}</button>
        {status === 'error' && <p className="field-note alert">{t('No se pudo guardar. Revisa los valores (por ejemplo, glucosa entre 20 y 600) y la conexión.', 'Could not save. Check the values (e.g. glucose between 20 and 600) and the connection.')}</p>}
        <p className="privacy-copy">{storage === 'supabase' ? t('Se guarda en la base de datos de la misión (Supabase); solo el backend puede leerla.', 'Saved in the mission database (Supabase); only the backend can read it.') : t('Guardado temporal en el servidor: falta crear la tabla de chequeos en Supabase.', 'Temporarily saved on the server: the check-ins table is missing in Supabase.')}</p>
      </article>

      <article className="breathing-panel"><span>{t('RECUPERACIÓN GUIADA', 'GUIDED RECOVERY')}</span><h3>{t('Respiración 4 · 6', 'Breathing 4 · 6')}</h3><div className="breath-orb"><div/><b>{t('INHALA', 'INHALE')}</b><small>{t('4 segundos', '4 seconds')}</small></div><p>{t('Realiza cinco ciclos lentos. La guía no sustituye una evaluación psicológica o médica.', 'Do five slow cycles. This guide does not replace a psychological or medical evaluation.')}</p></article>
      <article className="wellness-action"><span>{t('ACCIÓN RECOMENDADA', 'RECOMMENDED ACTION')}</span><h3>{concern ? t('Solicita apoyo de la tripulación', 'Ask the crew for support') : t('Mantén tu rutina de recuperación', 'Keep your recovery routine')}</h3><p>{concern ? t('Registra cómo te sientes, informa al responsable médico y realiza una pausa segura.', 'Log how you feel, tell the medical officer and take a safe break.') : t('Completa la rutina breve, hidrátate y vuelve a evaluar tu estado después del ejercicio.', 'Complete the short routine, hydrate and re-check how you feel after exercise.')}</p><div><i/>{t('Recomendación explicable, no diagnóstico', 'Explainable recommendation, not a diagnosis')}</div></article>

      <article className="checkin-history"><span>{t('TUS ÚLTIMOS 7 DÍAS', 'YOUR LAST 7 DAYS')}</span><h3>{t('Tendencia de sueño y ánimo', 'Sleep and mood trend')}</h3>
        {recent.length ? <><div className="mini-bars">{recent.map(c => <div key={c.created_at} title={new Date(c.created_at).toLocaleString(locale())}>
          <i className="sleep" style={{ height: `${Math.min(100, ((c.sleep_hours ?? 0) / 10) * 100)}%` }} /><i className="mood" style={{ height: `${((c.mood ?? 0) / 5) * 100}%` }} />
          <small>{new Date(c.created_at).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' })}</small></div>)}</div>
          <div className="legend"><span><i className="sleep" />{t('Sueño (h)', 'Sleep (h)')}</span><span><i className="mood" />{t('Ánimo (1–5)', 'Mood (1–5)')}</span></div>
          <ul className="checkin-list">{history.slice(0, 4).map(c => <li key={c.created_at}><b>{when(c.created_at)}</b> {t('sueño', 'sleep')} {c.sleep_hours ?? '—'} h · {t('ánimo', 'mood')} {c.mood ?? '—'}/5 · {t('tensión', 'stress')} {c.stress ?? '—'}/5{c.glucose_mg_dl != null && ` · ${t('glucosa', 'glucose')} ${c.glucose_mg_dl}`}{c.systolic_mmhg != null && ` · ${t('PA', 'BP')} ${c.systolic_mmhg}/${c.diastolic_mmhg ?? '—'}`}{c.temperature_c != null && ` · ${c.temperature_c} °C`}</li>)}</ul></>
          : <p className="privacy-copy">{t('Aún no hay chequeos. Guarda el primero para ver tu tendencia.', 'No check-ins yet. Save the first one to see your trend.')}</p>}
      </article>
    </div>
  </section>
}
