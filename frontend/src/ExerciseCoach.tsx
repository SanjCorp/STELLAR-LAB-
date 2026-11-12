import { useEffect, useMemo, useState } from 'react'

type MotionSample = { gx: number; gy: number; gz: number; respiration_rate_bpm: number | null; heart_rate_bpm: number | null }

const routines = [
  { id: 'knee', name: 'Elevación de rodilla', duration: '06:00', target: 'Cadera y piernas', cue: 'Eleva la rodilla de forma controlada y conserva el tronco estable.' },
  { id: 'hip', name: 'Movilidad de cadera', duration: '05:00', target: 'Cadera y equilibrio', cue: 'Abre la pierna hacia un lado sin inclinar el torso.' },
  { id: 'shoulder', name: 'Rotación de hombros', duration: '04:00', target: 'Hombros y espalda', cue: 'Mueve ambos brazos de manera simétrica y mantén la respiración fluida.' },
  { id: 'breath', name: 'Respiración de recuperación', duration: '03:00', target: 'Estrés y recuperación', cue: 'Inhala cuatro segundos y exhala seis segundos sin forzar.' },
]

function Figure({ pose, phase, view, live = false, motion = 0 }: { pose: string; phase: number; view: number; live?: boolean; motion?: number }) {
  const swing = phase % 2 === 0 ? 1 : -1
  const offset = live ? Math.max(-8, Math.min(8, motion)) : 0
  const vars = useMemo(() => {
    let la = -12, ra = 12, ll = 3, rl = -3, torso = 0
    if (pose === 'knee') { ll = swing > 0 ? -48 : 5; rl = swing < 0 ? 48 : -5; la = swing * 22; ra = swing * 18 }
    if (pose === 'hip') { ll = swing > 0 ? -42 : 5; rl = swing < 0 ? 42 : -5; la = -32; ra = 32 }
    if (pose === 'shoulder') { la = -68 + swing * 20; ra = 68 - swing * 20; torso = swing * 3 }
    if (pose === 'breath') { la = -28 - phase * 3; ra = 28 + phase * 3; torso = phase % 2 ? 2 : -2 }
    return {
      '--view': `${view}deg`, '--la': `${la + offset}deg`, '--ra': `${ra - offset}deg`,
      '--ll': `${ll + offset / 2}deg`, '--rl': `${rl - offset / 2}deg`, '--torso': `${torso}deg`,
    } as React.CSSProperties
  }, [pose, phase, view, live, offset])

  return <div className={`figure-wrap ${live ? 'live-figure' : 'guide-figure'}`}>
    <span>{live ? 'MOVIMIENTO ACTUAL' : 'MOVIMIENTO GUÍA'}</span>
    <div className="figure3d" style={vars} aria-label={live ? 'Representación estimada del movimiento actual' : 'Movimiento recomendado'}>
      <div className="body-part head">
        <i className="hair"/><i className="ear ear-left"/><i className="ear ear-right"/>
        <i className="eyebrow brow-left"/><i className="eyebrow brow-right"/><i className="eye eye-left"/><i className="eye eye-right"/>
        <i className="nose"/><i className="mouth"/>
      </div>
      <i className="body-part neck"/>
      <div className="body-part torso"><i className="suit-collar"/><i className="zipper"/><i className="mission-patch">S</i><i className="name-patch">CREW 01</i><i className="utility-pocket"/></div>
      <div className="body-part arm left"><i className="sleeve-patch">01</i></div><div className="body-part arm right"><i className="sleeve-stripe"/></div>
      <div className="body-part leg left"><i className="knee-pad"/></div><div className="body-part leg right"><i className="knee-pad"/></div>
      <i className="body-part joint shoulder-l"/><i className="body-part joint shoulder-r"/><i className="body-part joint hip-l"/><i className="body-part joint hip-r"/>
    </div>
  </div>
}

export default function ExerciseCoach({ sample }: { sample: MotionSample | null }) {
  const [selected, setSelected] = useState(0)
  const [phase, setPhase] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [view, setView] = useState(-12)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => { setPhase(p => (p + 1) % 4); setElapsed(s => s + 1) }, 1000)
    return () => window.clearInterval(timer)
  }, [playing])

  const routine = routines[selected]
  const motion = sample ? (sample.gx + sample.gy + sample.gz) * 1.8 : 0
  const alignment = Math.round(Math.max(62, 94 - Math.abs(motion) * 1.6))
  const breathing = sample?.respiration_rate_bpm ?? 15.6

  return <section className="coach-page">
    <div className="coach-heading"><div><span>STELLAR MOTION COACH</span><h2>Entrenamiento guiado en 3D</h2><p>Compara el movimiento recomendado con la estimación del sensor colocado en el pie.</p></div><div className="session-health"><b>{Math.round(sample?.heart_rate_bpm ?? 72)} bpm</b><span>FC durante ejercicio</span><b>{breathing.toFixed(1)} rpm</b><span>Respiración</span></div></div>

    <div className="coach-layout">
      <aside className="routine-list" aria-label="Rutinas disponibles">
        <span>RUTINA DE HOY · 18 MIN</span>
        {routines.map((item, index) => <button key={item.id} className={selected === index ? 'selected' : ''} onClick={() => { setSelected(index); setPhase(0); setElapsed(0); setPlaying(false) }}><i>{String(index + 1).padStart(2, '0')}</i><div><b>{item.name}</b><small>{item.target} · {item.duration}</small></div></button>)}
      </aside>

      <article className="pose-panel">
        <div className="pose-toolbar"><div><span>EJERCICIO {selected + 1} DE {routines.length}</span><h3>{routine.name}</h3></div><div className="match"><b>{alignment}%</b><span>alineación estimada</span></div></div>
        <div className="pose-stage">
          <div className="deck-grid"/><Figure pose={routine.id} phase={phase} view={view}/><div className="pose-divider"/><Figure pose={routine.id} phase={phase} view={view} live motion={motion}/>
          <div className="orientation"><span>VISTA</span><input aria-label="Rotar vista 3D" type="range" min="-45" max="45" value={view} onChange={e => setView(Number(e.target.value))}/><b>{view}°</b></div>
        </div>
        <div className="coach-cue"><span>PASO {phase + 1}</span><p>{routine.cue}</p><div className="session-controls"><button className="primary-action" onClick={() => setPlaying(p => !p)}>{playing ? 'Pausar rutina' : 'Iniciar rutina'}</button><button onClick={() => setPhase(p => (p + 1) % 4)}>Siguiente movimiento</button><b>{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</b></div></div>
      </article>

      <aside className="coach-feedback">
        <span>RETROALIMENTACIÓN</span><h3>{alignment > 82 ? 'Movimiento estable' : 'Ajusta la postura'}</h3><div className="alignment-ring" style={{'--score': `${alignment * 3.6}deg`} as React.CSSProperties}><b>{alignment}</b><small>/100</small></div>
        <ul><li><i className="ok"/>Ritmo controlado</li><li><i className="ok"/>Zona cardiaca estable</li><li><i className={breathing > 20 ? 'watch' : 'ok'}/>{breathing > 20 ? 'Reduce la intensidad' : 'Respiración uniforme'}</li></ul>
        <div className="safety-note"><b>Seguridad</b><p>Detén la rutina si aparece dolor, mareo o dificultad respiratoria y sigue el protocolo médico de la misión.</p></div>
      </aside>
    </div>
  </section>
}

