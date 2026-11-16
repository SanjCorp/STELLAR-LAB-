import { useEffect, useState } from 'react'
import { apiFetch } from './api'

/*
 * Sensor de posición del celular: PASOS + BRÚJULA (navegación a estima).
 *
 * - Pasos: el acelerómetro del celular (con gravedad) marca un pico en cada paso.
 *   Un pico solo es "paso" si:
 *     1) sube entre STEP_THRESHOLD y SHAKE_ACCEL sobre el promedio (más = sacudida),
 *     2) el celular no gira más de SHAKE_ROT °/s durante el pico (sacudir lo hace girar mucho),
 *     3) tiene RITMO de caminata: se necesitan WALK_CONFIRM picos seguidos separados entre
 *        MIN_STEP_MS y MAX_STEP_MS, con intervalos parecidos. Recién entonces se cuentan
 *        (también los que estaban en espera). Golpes sueltos o sacudidas no mueven al personaje.
 *   Tras una sacudida se ignora todo durante SHAKE_HOLD_MS.
 * - Brújula: rumbo magnético del celular (Android: deviceorientationabsolute; iPhone:
 *   webkitCompassHeading). Al pulsar "Poner en cero" el rumbo actual pasa a ser "adelante" (+Y).
 * - Cada paso mueve la posición STEP_LENGTH_M metros hacia donde apunta el celular.
 *
 * No integra la aceleración dos veces (como el MPU6050): por eso no se "desboca".
 * Se envía al backend una vez por segundo (POST /api/phone-position).
 * Es un objeto único para toda la app: sigue funcionando aunque cambies de pantalla.
 */

const STEP_THRESHOLD = 1.2   // m/s² sobre el promedio
const SHAKE_ACCEL = 7        // m/s²: un pico más fuerte que esto es una sacudida, no un paso
const SHAKE_ROT = 250        // °/s: girar más rápido que esto durante el pico = sacudida
const SHAKE_HOLD_MS = 1200
const REARM_LEVEL = 0.3      // debe bajar a esto antes de contar otro paso
const MIN_STEP_MS = 380      // más rápido que ~2,6 pasos/s no es caminar
const MAX_STEP_MS = 1300     // más lento: se perdió el ritmo
const WALK_CONFIRM = 3       // picos seguidos con ritmo para empezar a contar
const SEND_MS = 1000
export const STEP_LENGTH_M = 0.7

export type PhoneState = {
  active: boolean
  astronautId: string | null
  steps: number
  x: number
  y: number
  heading: number | null      // rumbo relativo al cero (grados, 0 = adelante)
  compass: boolean            // ¿llegan datos de brújula?
  walking: boolean            // ¿detecta ritmo de caminata ahora?
  ignored: number             // sacudidas / golpes descartados
  motion: boolean             // ¿llegan datos del acelerómetro?
  lastSentOk: boolean | null
  error: string | null
}

type Listener = (s: PhoneState) => void

let state: PhoneState = { active: false, astronautId: null, steps: 0, x: 0, y: 0, heading: null, compass: false, walking: false, ignored: 0, motion: false, lastSentOk: null, error: null }
const listeners = new Set<Listener>()
let rawHeading: number | null = null
let heading0: number | null = null
let fast = 9.81, slow = 9.81, armed = true
// Pico en curso (desde que cruza el umbral hasta que vuelve a bajar)
let peakStart = 0, peakMax = 0, peakRot = 0, inPeak = false
let shakeUntil = 0, lastPeak = 0, lastInterval = 0, quick = 0
let pending: number[] = []   // rumbos de los pasos en espera de confirmar el ritmo
let sendTimer: number | undefined
let wakeLock: { release: () => Promise<void> } | null = null
let battery: number | null = null

function emit(patch: Partial<PhoneState>) {
  state = { ...state, ...patch }
  listeners.forEach(l => l(state))
}

export const phoneSupported = () => typeof window !== 'undefined' && ('DeviceMotionEvent' in window || 'DeviceOrientationEvent' in window)

function screenAngle() {
  const o = (screen as Screen & { orientation?: { angle: number } }).orientation
  return o?.angle ?? ((window as unknown as { orientation?: number }).orientation ?? 0)
}

function onOrientation(e: DeviceOrientationEvent) {
  const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
  let h: number | null = null
  if (typeof ios === 'number') h = ios
  else if (e.alpha != null && (e.absolute || e.type === 'deviceorientationabsolute')) h = 360 - e.alpha
  if (h == null) return
  h = (h + screenAngle() + 360) % 360
  // Suavizado circular (la brújula del celular tiembla un poco).
  if (rawHeading == null) rawHeading = h
  else { const d = ((h - rawHeading + 540) % 360) - 180; rawHeading = (rawHeading + d * 0.2 + 360) % 360 }
  if (heading0 == null) heading0 = rawHeading
  emit({ compass: true, heading: Math.round((rawHeading - heading0 + 360) % 360) })
}

function onMotion(e: DeviceMotionEvent) {
  const g = e.accelerationIncludingGravity
  let mag: number
  if (g && g.x != null && g.y != null && g.z != null) mag = Math.hypot(g.x, g.y, g.z)
  else if (e.acceleration && e.acceleration.x != null) mag = 9.81 + Math.hypot(e.acceleration.x, e.acceleration.y ?? 0, e.acceleration.z ?? 0)
  else return
  const r = e.rotationRate
  const rot = r ? Math.hypot(r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0) : 0
  fast += (mag - fast) * 0.35   // quita el temblor
  slow += (mag - slow) * 0.02   // promedio lento (≈ gravedad)
  const over = fast - slow
  const now = performance.now()
  if (!state.motion) emit({ motion: true })
  if (now < shakeUntil) { armed = false; inPeak = false; return }
  if (armed && over > STEP_THRESHOLD) { armed = false; inPeak = true; peakStart = now; peakMax = over; peakRot = rot }
  if (inPeak) {
    peakMax = Math.max(peakMax, over); peakRot = Math.max(peakRot, rot)
    if (peakMax > SHAKE_ACCEL || peakRot > SHAKE_ROT || now - peakStart > 700) return shake(now)
  }
  if (!armed && over < REARM_LEVEL) {
    armed = true
    if (inPeak) { inPeak = false; onPeak(peakStart) }
  }
}

function shake(now: number) {
  shakeUntil = now + SHAKE_HOLD_MS
  inPeak = false; pending = []; lastPeak = 0; lastInterval = 0; quick = 0
  emit({ walking: false, ignored: state.ignored + 1 })
}

function relHeading() { return ((rawHeading ?? 0) - (heading0 ?? rawHeading ?? 0)) * Math.PI / 180 }

function addSteps(headings: number[]) {
  let { x, y } = state
  for (const h of headings) { x += STEP_LENGTH_M * Math.sin(h); y += STEP_LENGTH_M * Math.cos(h) }
  emit({ steps: state.steps + headings.length, x, y, walking: true })
}

/** Un pico válido (no sacudida): decide si forma parte de una caminata con ritmo. */
function onPeak(t: number) {
  if (lastPeak && t - lastPeak < MIN_STEP_MS) {
    // Demasiado rápido para un paso: rompe el ritmo; dos seguidos = vibración/sacudida.
    lastPeak = t
    if (++quick >= 2) { shake(t); return }
    if (pending.length || state.walking) emit({ walking: false, ignored: state.ignored + pending.length })
    pending = []; lastInterval = 0
    return
  }
  quick = 0
  const interval = lastPeak ? t - lastPeak : 0
  lastPeak = t
  const h = relHeading()
  const rhythmic = interval >= MIN_STEP_MS && interval <= MAX_STEP_MS &&
    (!lastInterval || Math.abs(interval - lastInterval) <= 0.45 * lastInterval)
  if (!interval || !rhythmic) {
    // Primer pico o ritmo roto: empieza una nueva espera (si había caminata, terminó).
    if (pending.length || state.walking) emit({ walking: false, ignored: state.ignored + (pending.length ? pending.length : 0) })
    pending = [h]
    lastInterval = 0
    return
  }
  lastInterval = interval
  if (state.walking) { addSteps([h]); return }
  pending.push(h)
  if (pending.length >= WALK_CONFIRM) { addSteps(pending); pending = [] }
}

async function send() {
  if (!state.active || !state.astronautId) return
  try {
    const res = await apiFetch('/api/phone-position', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ astronaut_id: state.astronautId, x_m: state.x, y_m: state.y, steps: state.steps, battery_pct: battery, timestamp_ms: Date.now() }),
    })
    emit({ lastSentOk: res.ok })
  } catch { emit({ lastSentOk: false }) }
}

async function keepAwake() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    if (nav.wakeLock) wakeLock = await nav.wakeLock.request('screen')
  } catch { /* no disponible: la pantalla puede apagarse */ }
}

function onVisible() { if (document.visibilityState === 'visible' && state.active) keepAwake() }

/** Debe llamarse desde un toque/clic (el iPhone pide permiso en ese momento). */
export async function startPhone(astronautId: string): Promise<boolean> {
  if (!window.isSecureContext) { emit({ error: 'https' }); return false }
  if (!phoneSupported()) { emit({ error: 'unsupported' }); return false }
  // iPhone: pide permiso. Si lo niega se sigue escuchando igual: si no llegan datos, la UI lo avisa.
  let denied = false
  try {
    type Perm = { requestPermission?: () => Promise<'granted' | 'denied'> }
    const dm = window.DeviceMotionEvent as unknown as Perm, dor = window.DeviceOrientationEvent as unknown as Perm
    if (dm?.requestPermission && (await dm.requestPermission()) !== 'granted') denied = true
    if (dor?.requestPermission && (await dor.requestPermission()) !== 'granted') denied = true
  } catch { denied = true }
  stopPhone(false)
  window.addEventListener('devicemotion', onMotion)
  window.addEventListener('deviceorientationabsolute', onOrientation as EventListener)
  window.addEventListener('deviceorientation', onOrientation)
  document.addEventListener('visibilitychange', onVisible)
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; addEventListener: (e: string, f: () => void) => void }> }
    const b = await nav.getBattery?.()
    if (b) { battery = Math.round(b.level * 100); b.addEventListener('levelchange', () => { battery = Math.round(b.level * 100) }) }
  } catch { /* sin batería */ }
  keepAwake()
  emit({ active: true, astronautId, error: denied ? 'denied' : null, lastSentOk: null })
  send(); sendTimer = window.setInterval(send, SEND_MS)
  return true
}

export function stopPhone(notify = true) {
  window.removeEventListener('devicemotion', onMotion)
  window.removeEventListener('deviceorientationabsolute', onOrientation as EventListener)
  window.removeEventListener('deviceorientation', onOrientation)
  document.removeEventListener('visibilitychange', onVisible)
  window.clearInterval(sendTimer); sendTimer = undefined
  wakeLock?.release().catch(() => {}); wakeLock = null
  if (notify) emit({ active: false })
}

/** Punto 0 = aquí, y "adelante" = hacia donde apunta el celular ahora. */
export function resetPhone() {
  heading0 = rawHeading
  pending = []; lastPeak = 0; lastInterval = 0
  emit({ steps: 0, x: 0, y: 0, heading: rawHeading == null ? null : 0, walking: false, ignored: 0 })
  send()
}

export function usePhone(): PhoneState {
  const [s, setS] = useState(state)
  useEffect(() => { listeners.add(setS); setS(state); return () => { listeners.delete(setS) } }, [])
  return s
}

// --------------------------------------------------------------------------- //
// Fuente de posición preferida (se recuerda en este navegador)
// --------------------------------------------------------------------------- //
export type PositionPrefer = 'mpu' | 'phone' | 'sim'
const PREFER_KEY = 'stellar-pos-source'
const preferListeners = new Set<(p: PositionPrefer) => void>()

function readPrefer(): PositionPrefer {
  try { const v = localStorage.getItem(PREFER_KEY); if (v === 'mpu' || v === 'phone' || v === 'sim') return v } catch { /* sin almacenamiento */ }
  return 'mpu'
}

export function usePositionPrefer(): [PositionPrefer, (p: PositionPrefer) => void] {
  const [p, setP] = useState<PositionPrefer>(readPrefer)
  useEffect(() => { preferListeners.add(setP); return () => { preferListeners.delete(setP) } }, [])
  const set = (v: PositionPrefer) => {
    try { localStorage.setItem(PREFER_KEY, v) } catch { /* sin almacenamiento */ }
    preferListeners.forEach(l => l(v))
  }
  return [p, set]
}
