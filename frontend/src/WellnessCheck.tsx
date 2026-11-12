import { useState } from 'react'

export default function WellnessCheck() {
  const [mood, setMood] = useState(3)
  const [stress, setStress] = useState(2)
  const [saved, setSaved] = useState(false)

  return <section className="wellness-page">
    <div className="wellness-heading"><span>BEHAVIORAL HEALTH · PRIVATE CHECK-IN</span><h2>Bienestar de la tripulación</h2><p>Una revisión breve ayuda al astronauta a reconocer cambios relacionados con aislamiento, carga de trabajo y recuperación.</p></div>
    <div className="wellness-grid">
      <article className="checkin-panel"><span>REGISTRO DIARIO</span><h3>¿Cómo te sientes hoy?</h3><label>Estado de ánimo <b>{mood}/5</b><input type="range" min="1" max="5" value={mood} onChange={e => { setMood(Number(e.target.value)); setSaved(false) }}/></label><div className="scale"><span>Muy bajo</span><span>Estable</span><span>Muy bien</span></div>
        <label>Nivel de tensión <b>{stress}/5</b><input type="range" min="1" max="5" value={stress} onChange={e => { setStress(Number(e.target.value)); setSaved(false) }}/></label><div className="scale"><span>Bajo</span><span>Moderado</span><span>Alto</span></div>
        <button className="primary-action" onClick={() => setSaved(true)}>{saved ? 'Registro guardado localmente' : 'Guardar chequeo'}</button><p className="privacy-copy">El prototipo conserva este registro únicamente en esta sesión local.</p>
      </article>
      <article className="breathing-panel"><span>RECUPERACIÓN GUIADA</span><h3>Respiración 4 · 6</h3><div className="breath-orb"><div/><b>INHALA</b><small>4 segundos</small></div><p>Realiza cinco ciclos lentos. La guía no sustituye una evaluación psicológica o médica.</p></article>
      <article className="wellness-action"><span>ACCIÓN RECOMENDADA</span><h3>{stress >= 4 || mood <= 2 ? 'Solicita apoyo de la tripulación' : 'Mantén tu rutina de recuperación'}</h3><p>{stress >= 4 || mood <= 2 ? 'Registra cómo te sientes, informa al responsable médico y realiza una pausa segura.' : 'Completa la rutina breve, hidrátate y vuelve a evaluar tu estado después del ejercicio.'}</p><div><i/>Recomendación explicable, no diagnóstico</div></article>
    </div>
  </section>
}
