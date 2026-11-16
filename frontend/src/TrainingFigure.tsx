import { useEffect, useState, type ReactNode } from 'react'

// Muñeco de entrenamiento visto de lado (mismo astronauta: traje azul, parches, botas),
// con articulaciones marcadas como en el diseño de Chuy. `f` = cuánto del movimiento
// está hecho (0 = posición inicial, 1 = rango completo). Para carrera y bicicleta, `cycle`
// es la fase del ciclo (0..1).

export type Exercise = 'squat' | 'deadlift' | 'calf' | 'bench' | 'run' | 'cevis'
type P = [number, number]

const THIGH = 58, SHIN = 58, TORSO = 74, UPPER = 42, FORE = 40, FOOT = 22
const GROUND = 262
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]]
const polar = (len: number, deg: number): P => [len * Math.sin((deg * Math.PI) / 180), -len * Math.cos((deg * Math.PI) / 180)]

/** Articulación intermedia (rodilla o codo) entre a y b; con el miembro hacia abajo, side = 1 la lleva hacia adelante (+x). */
function ik(a: P, b: P, l1: number, l2: number, side: 1 | -1): P {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.5) || 0.5
  const k = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, l1 * l1 - k * k))
  const ux = dx / d, uy = dy / d
  return [a[0] + k * ux + side * h * uy, a[1] + k * uy - side * h * ux]
}

type Limb = { a: P; b: P; c: P }
type Pose = { hip: P; shoulder: P; head: P; legs: [Limb, Limb]; feet: [P, P]; arms: [Limb, Limb]; bar?: P; props: ReactNode }

function leg(hip: P, ankle: P, kneeSide: 1 | -1 = 1): Limb { return { a: hip, b: ik(hip, ankle, THIGH, SHIN, kneeSide), c: ankle } }
function arm(shoulder: P, hand: P, elbowSide: 1 | -1): Limb { return { a: shoulder, b: ik(shoulder, hand, UPPER, FORE, elbowSide), c: hand } }
const upright = (hip: P, lean: number) => { const shoulder = add(hip, polar(TORSO, lean)); return { shoulder, head: add(shoulder, polar(22, lean * 0.7)) } }
const platform = <g className="tf-prop"><rect x="54" y={GROUND + 2} width="96" height="9" rx="2" /><line x1="62" y1={GROUND + 11} x2="62" y2={GROUND + 20} /><line x1="142" y1={GROUND + 11} x2="142" y2={GROUND + 20} /></g>

function pose(ex: Exercise, f: number, cycle: number): Pose {
  const ankle: P = [100, GROUND - 4]
  const toe = (a: P, lift = 0): P => [a[0] + FOOT, a[1] + 4 - lift * 0]
  if (ex === 'squat' || ex === 'calf') {
    const heel = ex === 'calf' ? 14 * f : 0
    const a: P = [ankle[0], ankle[1] - heel]
    const hip: P = ex === 'squat' ? [100 - 40 * f, a[1] - 112 + 52 * f] : [100, a[1] - 113]
    const { shoulder, head } = upright(hip, ex === 'squat' ? 34 * f : 2)
    const hand: P = add(shoulder, [9, 2])
    return { hip, shoulder, head, legs: [leg(hip, a), leg(add(hip, [-3, 0]), add(a, [-3, 0]))], feet: [[a[0] + FOOT, ankle[1] + 4], [a[0] + FOOT - 3, ankle[1] + 4]],
      arms: [arm(shoulder, hand, -1), arm(add(shoulder, [-3, 0]), add(hand, [-4, 0]), -1)], bar: add(shoulder, [-2, -6]), props: platform }
  }
  if (ex === 'deadlift') {
    const hip: P = [100 - 34 * f, ankle[1] - 112 + 34 * f]
    const { shoulder, head } = upright(hip, 72 * f + 3)
    const hand: P = [shoulder[0] + 2, Math.min(shoulder[1] + UPPER + FORE - 6, GROUND - 26)]
    return { hip, shoulder, head, legs: [leg(hip, ankle), leg(add(hip, [-3, 0]), add(ankle, [-3, 0]))], feet: [toe(ankle), toe(add(ankle, [-3, 0]))],
      arms: [arm(shoulder, hand, 1), arm(add(shoulder, [-3, 0]), add(hand, [-3, 0]), 1)], bar: add(hand, [0, 4]), props: platform }
  }
  if (ex === 'bench') {
    const hip: P = [74, 196], shoulder: P = [148, 196], head: P = [170, 190]
    const footA: P = [34, GROUND - 4]
    const hand: P = [146, 172 - 66 * (1 - f)]
    const props = <g className="tf-prop"><rect x="60" y="204" width="104" height="9" rx="3" /><line x1="80" y1="213" x2="80" y2={GROUND + 6} /><line x1="146" y1="213" x2="146" y2={GROUND + 6} /><line x1="60" y1="200" x2="160" y2="200" className="tf-strap" /></g>
    return { hip, shoulder, head, legs: [leg(hip, footA, -1), leg(add(hip, [0, -2]), add(footA, [6, 0]), -1)], feet: [toe(footA), toe(add(footA, [6, 0]))],
      arms: [arm(shoulder, hand, 1), arm(add(shoulder, [-4, -2]), add(hand, [-4, 0]), 1)], bar: add(hand, [0, -4]), props }
  }
  if (ex === 'run') {
    const p = cycle * 2 * Math.PI
    const hip: P = [100, GROUND - 112 + 4 * Math.abs(Math.sin(p))]
    const { shoulder, head } = upright(hip, 10)
    const foot = (q: number): P => [100 + 30 * Math.sin(q), GROUND - 4 - Math.max(0, 22 * Math.cos(q))]
    const hand = (q: number): P => add(shoulder, [16 - 22 * Math.sin(q), 46])
    const props = <g className="tf-prop"><rect x="36" y={GROUND + 1} width="130" height="10" rx="5" /><line x1={hip[0]} y1={hip[1]} x2="44" y2={GROUND + 2} className="tf-bungee" /><line x1={hip[0]} y1={hip[1]} x2="158" y2={GROUND + 2} className="tf-bungee" /></g>
    const fA = foot(p), fB = foot(p + Math.PI)
    return { hip, shoulder, head, legs: [leg(hip, fA), leg(hip, fB)], feet: [toe(fA), toe(fB)], arms: [arm(shoulder, hand(p + Math.PI), -1), arm(shoulder, hand(p), -1)], props }
  }
  // CEVIS: pelvis sujeta al asiento, pies en los pedales.
  const p = cycle * 2 * Math.PI
  const hip: P = [82, 168], crank: P = [128, 226]
  const { shoulder, head } = upright(hip, 24)
  const pedal = (q: number): P => [crank[0] + 20 * Math.cos(q), crank[1] + 20 * Math.sin(q)]
  const bar: P = [150, 150]
  const props = <g className="tf-prop"><line x1="82" y1="176" x2={crank[0]} y2={crank[1]} /><line x1="82" y1="176" x2="70" y2={GROUND + 6} /><line x1={crank[0]} y1={crank[1]} x2="146" y2={GROUND + 6} /><line x1={crank[0]} y1={crank[1]} x2="152" y2="152" /><rect x="66" y="170" width="30" height="7" rx="3" /><circle cx={crank[0]} cy={crank[1]} r="20" className="tf-ring" /></g>
  const pA = pedal(p), pB = pedal(p + Math.PI)
  return { hip, shoulder, head, legs: [leg(hip, pA), leg(hip, pB)], feet: [toe(pA), toe(pB)], arms: [arm(shoulder, bar, -1), arm(add(shoulder, [-3, 0]), add(bar, [-3, 0]), -1)], props }
}

/** Fase continua del ciclo (para la guía y para carrera/bicicleta). */
export function useCycle(running: boolean, seconds = 4) {
  const [c, setC] = useState(0.35)
  useEffect(() => {
    if (!running) return
    let frame = 0; const t0 = performance.now() - c * seconds * 1000
    const loop = (now: number) => { setC(((now - t0) / 1000 / seconds) % 1); frame = requestAnimationFrame(loop) }
    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [running, seconds])
  return c
}

const seg = (a: P, b: P, cls: string, w: number) => <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={cls} strokeWidth={w} />

export default function TrainingFigure({ exercise, f, cycle, ghost = false }: { exercise: Exercise; f: number; cycle: number; ghost?: boolean }) {
  const ps = pose(exercise, Math.max(0, Math.min(1, f)), cycle)
  const [near, far] = [0, 1] as const
  const joints: P[] = [ps.hip, ps.legs[near].b, ps.legs[near].c, ps.shoulder, ps.arms[near].b]
  const lean = (Math.atan2(ps.shoulder[0] - ps.hip[0], ps.hip[1] - ps.shoulder[1]) * 180) / Math.PI
  const patch = add(ps.hip, polar(TORSO * 0.62, lean))
  return <svg className={`training-figure ${ghost ? 'ghost' : ''}`} viewBox="0 0 200 280" aria-hidden="true">
    {ps.props}
    {/* extremidades del lado lejano (más oscuras) */}
    {seg(ps.arms[far].a, ps.arms[far].b, 'tf-far', 11)}{seg(ps.arms[far].b, ps.arms[far].c, 'tf-far', 10)}
    {seg(ps.legs[far].a, ps.legs[far].b, 'tf-far', 16)}{seg(ps.legs[far].b, ps.legs[far].c, 'tf-far', 14)}
    {seg(ps.legs[far].c, ps.feet[far], 'tf-boot', 10)}
    {/* torso, cabeza */}
    {seg(ps.hip, ps.shoulder, 'tf-torso', 30)}
    <circle cx={patch[0]} cy={patch[1]} r="5" className="tf-patch" />
    <g transform={`translate(${ps.head[0]} ${ps.head[1]}) rotate(${exercise === 'bench' ? 90 : lean * 0.7})`}>
      <circle r="15" className="tf-skin" /><path d="M-15 -1 A15 15 0 0 1 12 -9 L4 -5 L-9 -3 Z" className="tf-hair" /><circle cx="8" cy="-2" r="1.8" className="tf-eye" /><circle cx="-3" cy="1" r="3" className="tf-ear" />
    </g>
    {/* extremidades del lado cercano */}
    {seg(ps.legs[near].a, ps.legs[near].b, 'tf-suit', 17)}{seg(ps.legs[near].b, ps.legs[near].c, 'tf-suit', 15)}
    {seg(ps.legs[near].c, ps.feet[near], 'tf-boot', 11)}
    {seg(ps.arms[near].a, ps.arms[near].b, 'tf-suit', 12)}{seg(ps.arms[near].b, ps.arms[near].c, 'tf-suit', 11)}
    <circle cx={ps.arms[near].c[0]} cy={ps.arms[near].c[1]} r="5.5" className="tf-skin" />
    {ps.bar && <g className="tf-bar"><circle cx={ps.bar[0]} cy={ps.bar[1]} r="9" /><circle cx={ps.bar[0]} cy={ps.bar[1]} r="3" /></g>}
    {joints.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" className="tf-joint" />)}
  </svg>
}
