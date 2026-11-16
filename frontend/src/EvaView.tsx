import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import Icon from './Icon'
import { apiFetch } from './api'
import { t } from './i18n'
import { usePositionPrefer } from './phoneTracker'
import { fallbackText, PhoneControls, positionUrl, sourceLabel, SourceSwitch, type Position } from './PositionSource'
import { profiles } from './profiles'

type CrewPosition = Position & { astronaut_id: string }
type Radiation = {
  dose_rate_usvh: number; level: 0 | 1 | 2 | 3; level_name: string; action: string; source: 'sensor' | 'simulation'
  device_id: string | null; age_s: number; live_window_s: number; thresholds_usvh: number[]; max_usvh?: number; history: [number, number][]
}
const RAD_COLOR = ['#35C99A', '#F2B84B', '#FF8A4C', '#FF5A5F']
const radLevelText = (l: number) => [t('Nominal', 'Nominal'), t('Elevada', 'Elevated'), t('Alta', 'High'), t('Tormenta solar', 'Solar storm')][l]
const radActionText = (l: number) => [
  t('Muy por debajo del máximo (17 µSv/h). Sin acción.', 'Well below the maximum (17 µSv/h). No action.'),
  t('Cerca del máximo: limitar el tiempo de EVA y vigilar la tendencia.', 'Close to the maximum: limit EVA time and watch the trend.'),
  t('Sobre el máximo permitido: terminar la EVA y volver a la cápsula.', 'Above the allowed maximum: end the EVA and return to the capsule.'),
  t('Más de 5 veces el máximo: toda la tripulación al refugio blindado de la nave.', 'Over 5× the maximum: whole crew to the shielded shelter.'),
][l]
/** 0..1 para la lluvia: escala logarítmica (0,5 µSv/h -> 0, 17 µSv/h (máximo) -> 0,6, 200 µSv/h -> 1). */
const radIntensity = (rate: number) => Math.min(1, Math.max(0, Math.log10(Math.max(rate, 0.5) / 0.5) / Math.log10(400)))
const fmtRad = (v: number) => v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)

function RadSpark({ h, th }: { h: [number, number][]; th: number[] }) {
  if (h.length < 2) return null
  const W = 260, H = 54, span = 300
  const max = Math.max(20, ...h.map(p => p[1])) * 1.15
  const y = (v: number) => (H - (v / max) * H).toFixed(1)
  const pts = h.map(([sec, v]) => `${(((sec + span) / span) * W).toFixed(1)},${y(v)}`).join(' ')
  return <svg className="eva-rad-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
    {th.filter(v => v < max).map((v, i) => <line key={v} x1="0" x2={W} y1={y(v)} y2={y(v)} stroke={RAD_COLOR[i + 1]} strokeDasharray="3 3" strokeOpacity="0.55" />)}
    <polyline points={pts} fill="none" stroke="#FFD84A" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
  </svg>
}
const crewInfo = (id: string) => profiles.find(p => p.id === id)
const srcTag = (s?: Position['source']) => s === 'hardware' ? 'MPU' : s === 'phone' ? t('CEL', 'PHONE') : 'SIM'

const ZONE = {
  cabina: { color: '#45D6C5' },
  cerca: { color: '#35C99A' },
  atencion: { color: '#F2B84B' },
  fuera: { color: '#F16F78' },
}
const zoneText = (z: keyof typeof ZONE) => ({
  cabina: { label: t('Dentro de la cabina', 'Inside the cabin'), text: t('A 2 m o menos del punto 0: está dentro de la cápsula.', 'Within 2 m of point 0: inside the capsule.') },
  cerca: { label: t('Fuera de la cabina', 'Outside the cabin'), text: t('A más de 2 m del punto 0, en la zona cercana a la cápsula.', 'More than 2 m from point 0, in the zone near the capsule.') },
  atencion: { label: t('Atención', 'Attention'), text: t('Te acercas al largo del cable de seguridad.', 'You are nearing the safety tether length.') },
  fuera: { label: t('Fuera de rango', 'Out of range'), text: t('Más lejos que el cable de seguridad de referencia: regresa hacia la cápsula.', 'Beyond the reference safety tether: head back to the capsule.') },
})[z]

// Datos: X, Y en el plano y Z hacia arriba (metros desde el punto 0). En three.js "arriba" es Y.
const toScene = ([x, y, z]: [number, number, number]) => new THREE.Vector3(x, z, -y)

function textSprite(text: string, color = '#91A2B4', size = 64, width = 256) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.font = `600 ${size}px Inter, sans-serif`; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, width / 2, 64)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }))
  sprite.scale.set(4 * width / 256, 2, 1)
  return sprite
}

// Medidas de la cápsula (m). El cilindro habitable (r = 1, alto 2) cabe dentro del cono.
const CAP = { bottomR: 2.2, topR: 0.95, bottomY: -1.2, topY: 1.4 }

/** Cápsula tipo Orion: escudo térmico, casco cónico translúcido, túnel de acople, ventanas, asientos y paneles. */
function buildCapsule() {
  const g = new THREE.Group()
  const h = CAP.topY - CAP.bottomY
  // Casco cónico (translúcido para ver el interior) y sus aristas
  const hullGeo = new THREE.CylinderGeometry(CAP.topR, CAP.bottomR, h, 48, 1, true)
  const hull = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ color: '#c9d4df', metalness: 0.5, roughness: 0.4, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }))
  hull.position.y = (CAP.topY + CAP.bottomY) / 2; g.add(hull)
  const ribs = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CylinderGeometry(CAP.topR, CAP.bottomR, h, 16, 1, true)), new THREE.LineBasicMaterial({ color: '#79A9D8', transparent: true, opacity: 0.35 }))
  ribs.position.copy(hull.position); g.add(ribs)
  // Escudo térmico (base) y anillo de unión
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(CAP.bottomR + 0.05, CAP.bottomR - 0.25, 0.28, 48), new THREE.MeshStandardMaterial({ color: '#5a4636', roughness: 0.9 }))
  shield.position.y = CAP.bottomY - 0.14; g.add(shield)
  const floor = new THREE.Mesh(new THREE.CircleGeometry(CAP.bottomR - 0.05, 48), new THREE.MeshStandardMaterial({ color: '#192A3B', roughness: 0.9, side: THREE.DoubleSide }))
  floor.rotation.x = -Math.PI / 2; floor.position.y = CAP.bottomY + 0.01; g.add(floor)
  // Túnel de acople y escotilla superior
  const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.55, 32), new THREE.MeshStandardMaterial({ color: '#c9d4df', metalness: 0.6, roughness: 0.35, transparent: true, opacity: 0.55 }))
  tunnel.position.y = CAP.topY + 0.27; g.add(tunnel)
  const hatchRing = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 32), new THREE.MeshBasicMaterial({ color: '#45D6C5' }))
  hatchRing.rotation.x = Math.PI / 2; hatchRing.position.y = CAP.topY + 0.56; g.add(hatchRing)
  // Ventanas en el cono (lado de los paneles, +X)
  const slope = Math.atan2(CAP.bottomR - CAP.topR, h)
  for (const a of [-0.35, 0.35]) {
    const y = 0.75, r = CAP.topR + (CAP.bottomR - CAP.topR) * ((CAP.topY - y) / h) + 0.01
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.26), new THREE.MeshBasicMaterial({ color: '#79A9D8', transparent: true, opacity: 0.7, side: THREE.DoubleSide }))
    win.position.set(Math.cos(a) * r, y, Math.sin(a) * r); win.lookAt(win.position.clone().multiplyScalar(2).setY(y)); win.rotateX(-slope); g.add(win)
  }
  // Panel de control (frente, +X) con pantallas
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 1.5), new THREE.MeshStandardMaterial({ color: '#26394B', roughness: 0.6 }))
  panel.position.set(1.15, 0.05, 0); panel.rotation.z = -0.35; g.add(panel)
  for (const z of [-0.45, 0, 0.45]) {
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.28), new THREE.MeshBasicMaterial({ color: '#45D6C5', transparent: true, opacity: 0.55 }))
    screen.position.set(1.08, 0.08, z); screen.rotation.y = -Math.PI / 2; screen.rotation.x = 0; screen.rotateX(0.35); g.add(screen)
  }
  // 4 asientos reclinados mirando a los paneles (2 abajo, 2 arriba como en Orion)
  const seatMat = new THREE.MeshStandardMaterial({ color: '#3b5068', roughness: 0.7 })
  for (const [x, y, z] of [[-0.2, -0.95, -0.45], [-0.2, -0.95, 0.45], [-0.55, -0.35, -0.45], [-0.55, -0.35, 0.45]] as const) {
    const seat = new THREE.Group()
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 0.42), seatMat); seat.add(base)
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.6, 0.42), seatMat); back.position.set(-0.3, 0.26, 0); back.rotation.z = 0.45; seat.add(back)
    seat.position.set(x, y, z); g.add(seat)
  }
  return g
}

function buildAstronaut(accent = '#45D6C5') {
  const g = new THREE.Group()
  const suit = new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.7 })
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.7, 6, 16), suit); g.add(torso)
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 16), suit); helmet.position.y = 0.85; g.add(helmet)
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16, 0, Math.PI), new THREE.MeshStandardMaterial({ color: accent, emissive: new THREE.Color(accent).multiplyScalar(0.45), metalness: 0.9, roughness: 0.1 }))
  visor.position.set(0, 0.85, 0.1); g.add(visor)
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.9, 0.35), suit); pack.position.set(0, 0.15, -0.42); g.add(pack)
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.55, 4, 8), suit); arm.position.set(s * 0.58, 0.15, 0); arm.rotation.z = s * 0.5; g.add(arm)
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.6, 4, 8), suit); leg.position.set(s * 0.22, -0.85, 0); leg.rotation.z = s * 0.15; g.add(leg)
  }
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.08, depthWrite: false })); g.add(halo)
  g.scale.setScalar(0.85) // ~1,8 m, cabe dentro de la cápsula
  return g
}

export default function EvaView({ astronautId, name }: { astronautId: string; name: string }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<{ setData: (p: Position) => void; setCrew: (items: CrewPosition[]) => void; setRadiation: (k: number, on: boolean) => void; reset: () => void } | null>(null)
  const [pos, setPos] = useState<Position | null>(null)
  const [crew, setCrew] = useState<CrewPosition[]>([])
  const [showCrew, setShowCrew] = useState(true)
  const [rad, setRad] = useState<Radiation | null>(null)
  const [showRad, setShowRadState] = useState(() => { try { return localStorage.getItem('stellar-rad-rain') !== 'off' } catch { return true } })
  const setShowRad = (on: boolean) => { setShowRadState(on); try { localStorage.setItem('stellar-rad-rain', on ? 'on' : 'off') } catch { /* sin almacenamiento */ } }
  const [prefer, setPrefer] = usePositionPrefer()
  const [error, setError] = useState(false)

  // Escena 3D: se crea una sola vez
  useEffect(() => {
    const mount = mountRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000)
    camera.position.set(30, 24, 40)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true; controls.maxDistance = 140; controls.minDistance = 8

    scene.add(new THREE.AmbientLight('#8fb3d9', 0.9))
    const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(30, 40, 20); scene.add(sun)

    // Estrellas
    const starPos = new Float32Array(1500 * 3)
    for (let i = 0; i < starPos.length; i++) starPos[i] = (Math.random() - 0.5) * 900
    const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(starPos, 3)), new THREE.PointsMaterial({ color: '#c8d6e5', size: 0.8 }))
    scene.add(stars)

    // Radiación: "lluvia" amarilla de partículas. Más radiación = más gotas, más rápidas y más brillantes.
    const RAIN_MAX = 2200, RAIN_R = 45, RAIN_TOP = 40, RAIN_BOTTOM = -25
    const rainPos = new Float32Array(RAIN_MAX * 6)
    const rainSpeed = new Float32Array(RAIN_MAX)
    for (let i = 0; i < RAIN_MAX; i++) {
      const a = Math.random() * Math.PI * 2, r = RAIN_R * Math.sqrt(Math.random())
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y0 = RAIN_BOTTOM + Math.random() * (RAIN_TOP - RAIN_BOTTOM)
      rainPos.set([x, y0, z, x, y0 - 0.6, z], i * 6); rainSpeed[i] = 0.6 + Math.random() * 0.8
    }
    const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3))
    const rainMat = new THREE.LineBasicMaterial({ color: '#FFD84A', transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending })
    const rain = new THREE.LineSegments(rainGeo, rainMat); rain.frustumCulled = false; scene.add(rain)
    const rainLow = new THREE.Color('#FFD84A'), rainHigh = new THREE.Color('#FF9F3A')
    let rainK = 0, rainTarget = 0, lastT = 0
    const setRadiation = (k: number, on: boolean) => { rainTarget = k; rain.visible = on }
    const updateRain = (dt: number) => {
      rainK += (rainTarget - rainK) * Math.min(1, dt * 1.5)
      const count = Math.floor(120 + rainK * (RAIN_MAX - 120))
      const speed = 8 + 32 * rainK, len = 0.6 + 2.6 * rainK
      for (let i = 0; i < count; i++) {
        const o = i * 6
        let y = rainPos[o + 1] - rainSpeed[i] * speed * dt
        if (y < RAIN_BOTTOM) y += RAIN_TOP - RAIN_BOTTOM
        rainPos[o + 1] = y; rainPos[o + 4] = y - len
      }
      rainGeo.setDrawRange(0, count * 2); rainGeo.attributes.position.needsUpdate = true
      rainMat.opacity = 0.22 + 0.4 * rainK; rainMat.color.lerpColors(rainLow, rainHigh, rainK)
    }

    // Planeta de fondo
    const planet = new THREE.Mesh(new THREE.SphereGeometry(260, 64, 48), new THREE.MeshStandardMaterial({ color: '#1d5d9b', emissive: '#08223f', roughness: 0.9 }))
    planet.position.set(-260, -420, -820); scene.add(planet)

    // Referencias: rejilla, ejes, zonas
    const grid = new THREE.PolarGridHelper(30, 12, 6, 64, '#26394B', '#1a2a3a'); grid.position.y = -0.01; scene.add(grid)
    const axes: [THREE.Vector3, string, string][] = [[new THREE.Vector3(32, 0, 0), '#F16F78', 'X'], [new THREE.Vector3(0, 0, -32), '#35C99A', 'Y'], [new THREE.Vector3(0, 32, 0), '#79A9D8', 'Z']]
    for (const [end, color, label] of axes) {
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), end]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 })))
      const s = textSprite(label, color); s.position.copy(end.clone().multiplyScalar(1.06)); scene.add(s)
    }
    const zoneMat = (color: string) => new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.035, depthWrite: false })
    const safeSphere = new THREE.Mesh(new THREE.SphereGeometry(15, 18, 10), zoneMat('#35C99A')); scene.add(safeSphere)
    const tetherSphere = new THREE.Mesh(new THREE.SphereGeometry(25, 24, 12), zoneMat('#F2B84B')); scene.add(tetherSphere)
    const zero = textSprite("Punto 0", "#45D6C5", 44); zero.position.set(0, 3.2, 0); scene.add(zero)

    scene.add(buildCapsule()) // a escala real: cápsula de ~4 m de base; cabina = 2 m alrededor del punto 0
    const astronaut = buildAstronaut(crewInfo(astronautId)?.accent); scene.add(astronaut)

    // Resto de la tripulación: un astronauta por perfil, con su color y su nombre encima.
    type Mate = { body: THREE.Group; label: THREE.Sprite; trail: THREE.Line; target: THREE.Vector3; seen: boolean; text: string }
    const mates = new Map<string, Mate>()
    const mateFor = (id: string) => {
      let m = mates.get(id)
      if (!m) {
        const accent = crewInfo(id)?.accent ?? '#c8d6e5'
        const body = buildAstronaut(accent); body.scale.setScalar(0.75); scene.add(body)
        const trailLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.45 })); scene.add(trailLine)
        m = { body, label: new THREE.Sprite(), trail: trailLine, target: new THREE.Vector3(), seen: false, text: '' }
        scene.add(m.label); mates.set(id, m)
      }
      return m
    }
    const setCrew = (items: CrewPosition[]) => {
      const present = new Set<string>()
      for (const it of items) {
        if (it.astronaut_id === astronautId) continue
        present.add(it.astronaut_id)
        const m = mateFor(it.astronaut_id)
        m.target = toScene([it.x, it.y, it.z])
        if (!m.seen) { m.body.position.copy(m.target); m.seen = true }
        const text = `${crewInfo(it.astronaut_id)?.shortName ?? it.astronaut_id} · ${srcTag(it.source)}`
        if (text !== m.text) {
          scene.remove(m.label); (m.label.material as THREE.SpriteMaterial).map?.dispose()
          m.label = textSprite(text, crewInfo(it.astronaut_id)?.accent ?? '#c8d6e5', 60, 512); m.label.scale.set(4.2, 1.05, 1)
          scene.add(m.label); m.text = text
        }
        m.trail.geometry.dispose(); m.trail.geometry = new THREE.BufferGeometry().setFromPoints(it.trail.map(toScene))
      }
      for (const [id, m] of mates) { const on = present.has(id); m.body.visible = on; m.label.visible = on; m.trail.visible = on }
    }

    const tetherMat = new THREE.LineDashedMaterial({ color: '#45D6C5', dashSize: 0.6, gapSize: 0.4 })
    const tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), tetherMat); scene.add(tether)
    const trailMat = new THREE.LineBasicMaterial({ color: '#79A9D8', transparent: true, opacity: 0.7 })
    const trail = new THREE.Line(new THREE.BufferGeometry(), trailMat); scene.add(trail)

    let target = new THREE.Vector3(); let first = true
    const setData = (p: Position) => {
      target = toScene([p.x, p.y, p.z])
      if (first) { astronaut.position.copy(target); first = false }
      const color = ZONE[p.zone].color
      tetherMat.color.set(color)
      trail.geometry.dispose(); trail.geometry = new THREE.BufferGeometry().setFromPoints(p.trail.map(toScene))
    }
    const reset = () => { camera.position.set(30, 24, 40); controls.target.set(0, 0, 0) }

    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize); observer.observe(mount); resize()

    let frame = 0
    const clock = new THREE.Clock()
    const loop = () => {
      frame = requestAnimationFrame(loop)
      const t = clock.getElapsedTime()
      astronaut.position.lerp(target, 0.06) // movimiento suave entre lecturas (1 por segundo)
      astronaut.rotation.y = t * 0.3; astronaut.rotation.z = Math.sin(t * 0.7) * 0.15
      for (const m of mates.values()) {
        m.body.position.lerp(m.target, 0.06); m.body.rotation.y = t * 0.3
        m.label.position.copy(m.body.position).add(new THREE.Vector3(0, 1.5, 0))
      }
      tether.geometry.setFromPoints([new THREE.Vector3(), astronaut.position.clone()]); tether.computeLineDistances()
      stars.rotation.y = t * 0.002
      if (rain.visible) updateRain(Math.min(0.1, t - lastT))
      lastT = t
      controls.update(); renderer.render(scene, camera)
      // Etiqueta de distancia encima del astronauta
      const label = labelRef.current
      if (label) {
        const v = astronaut.position.clone().add(new THREE.Vector3(0, 1.8, 0)).project(camera)
        label.style.transform = `translate(-50%, -100%) translate(${(v.x * 0.5 + 0.5) * mount.clientWidth}px, ${(-v.y * 0.5 + 0.5) * mount.clientHeight}px)`
        label.style.opacity = v.z < 1 ? '1' : '0'
      }
    }
    loop()
    sceneRef.current = { setData, setCrew, setRadiation, reset }
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); renderer.dispose()
      scene.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose?.() })
      mount.removeChild(renderer.domElement); sceneRef.current = null
    }
  }, [])

  // Datos: una consulta por segundo
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await apiFetch(positionUrl(astronautId, prefer))
        if (!res.ok) throw new Error(String(res.status))
        const data: Position = await res.json()
        if (alive) { setPos(data); setError(false); sceneRef.current?.setData(data) }
      } catch { if (alive) setError(true) }
    }
    load(); const timer = window.setInterval(load, 1000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [astronautId, prefer])

  // Resto de la tripulación (todas en una consulta), cada segundo
  useEffect(() => {
    if (!showCrew) { setCrew([]); sceneRef.current?.setCrew([]); return }
    let alive = true
    const load = async () => {
      try {
        const res = await apiFetch(`/api/crew-positions?prefer=${prefer}&limit=30`)
        if (!res.ok) return
        const items: CrewPosition[] = (await res.json()).items
        if (alive) { setCrew(items); sceneRef.current?.setCrew(items) }
      } catch { /* sin cambios */ }
    }
    load(); const timer = window.setInterval(load, 1000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [prefer, showCrew, astronautId])

  // Radiación de la nave, cada 2 s
  useEffect(() => {
    let alive = true
    const load = async () => {
      try { const res = await apiFetch('/api/radiation'); if (res.ok && alive) setRad(await res.json()) } catch { /* sin cambios */ }
    }
    load(); const timer = window.setInterval(load, 2000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])
  useEffect(() => { sceneRef.current?.setRadiation(rad ? radIntensity(rad.dose_rate_usvh) : 0, showRad) }, [rad, showRad])

  const zone = { ...(pos ? ZONE[pos.zone] : ZONE.cerca), ...zoneText(pos?.zone ?? 'cerca') }
  const radColor = RAD_COLOR[rad?.level ?? 0]
  return <section className="eva-page">
    <div className="eva-stage">
      <div ref={mountRef} className="eva-canvas" />
      <div ref={labelRef} className="eva-label" style={{ borderColor: zone.color }}><b>{pos ? `${pos.distance_m.toFixed(1)} m` : '—'}</b><small>{name}</small></div>
      <div className="eva-hud">
        <span className={`eva-source ${pos && pos.source !== 'simulation' ? 'real' : ''}`}>{t('POSICIÓN', 'POSITION')} · {sourceLabel(pos?.source)}</span>
        {fallbackText(pos) && <span className="eva-source warn">{fallbackText(pos)}</span>}
        {rad && <span className="eva-source rad" style={{ color: radColor, borderColor: radColor }}>{t('RADIACIÓN', 'RADIATION')} · {fmtRad(rad.dose_rate_usvh)} µSv/h · {rad.source === 'sensor' ? t('SENSOR', 'SENSOR') : 'SIM'}</span>}
        {error && <span className="eva-source off">{t('Sin conexión con la API', 'No connection to the API')}</span>}
      </div>
      <div className="eva-controls">
        <button onClick={() => sceneRef.current?.reset()}>{t('Centrar vista', 'Reset view')}</button>
        <label><input type="checkbox" checked={showCrew} onChange={e => setShowCrew(e.target.checked)} /> {t('Tripulación', 'Crew')}</label>
        <label><input type="checkbox" checked={showRad} onChange={e => setShowRad(e.target.checked)} /> {t('Radiación', 'Radiation')}</label>
        <SourceSwitch prefer={prefer} onChange={setPrefer} pos={pos} />
      </div>
      <p className="eva-hint">{t('Arrastra para girar · rueda para acercar', 'Drag to rotate · scroll to zoom')}</p>
    </div>

    <div className="eva-side">
      <article className="eva-distance" style={{ borderColor: zone.color }}>
        <span><Icon name="cohete" size={16} /> {t('DISTANCIA A LA CÁPSULA', 'DISTANCE TO THE CAPSULE')}</span>
        <b style={{ color: zone.color }}>{pos ? pos.distance_m.toFixed(1) : '—'}<small> m</small></b>
        <p><i style={{ background: zone.color }} />{zone.label} · {zone.text}</p>
        <div className="eva-bar"><i style={{ width: `${Math.min(100, ((pos?.distance_m ?? 0) / (pos?.tether_m ?? 25)) * 100)}%`, background: zone.color }} /><em style={{ left: `${((pos?.safe_m ?? 15) / (pos?.tether_m ?? 25)) * 100}%` }} /></div>
        <small className="eva-scale"><span>0 m</span><span>{pos?.safe_m ?? 15} m</span><span>{pos?.tether_m ?? 25} m {t('cable', 'tether')}</span></small>
      </article>
      <article className="eva-rad" style={{ borderColor: radColor }}>
        <span>{t('RADIACIÓN EN LA NAVE', 'RADIATION ON THE SHIP')}</span>
        <div className="eva-rad-top">
          <b style={{ color: radColor }}>{rad ? fmtRad(rad.dose_rate_usvh) : '—'}<small> µSv/h</small></b>
          {rad && <em style={{ color: radColor, borderColor: radColor }}>{radLevelText(rad.level)}</em>}
        </div>
        {rad && <p>{radActionText(rad.level)}</p>}
        {rad && <RadSpark h={rad.history} th={rad.thresholds_usvh} />}
        <small className="eva-rad-src">{!rad ? '…' : rad.source === 'sensor'
          ? t(`Sensor (${rad.device_id ?? 'ESP32'}) · hace ${Math.round(rad.age_s)} s`, `Sensor (${rad.device_id ?? 'ESP32'}) · ${Math.round(rad.age_s)} s ago`)
          : t(`Simulación · sin lecturas en ${rad.live_window_s / 60} min`, `Simulation · no readings in ${rad.live_window_s / 60} min`)}
          {rad && ` · ${t('últimos 5 min · máximo permitido', 'last 5 min · allowed maximum')} ${rad.max_usvh ?? 17} µSv/h (${((rad.max_usvh ?? 17) / 1000).toFixed(3)} mSv/h)`}</small>
      </article>
      <article className="eva-coords">
        <div><span>X</span><b>{pos?.x.toFixed(1) ?? '—'}</b><small>m</small></div>
        <div><span>Y</span><b>{pos?.y.toFixed(1) ?? '—'}</b><small>m</small></div>
        <div><span>Z</span><b>{pos?.z.toFixed(1) ?? '—'}</b><small>m</small></div>
        <div><span>{t('Velocidad', 'Speed')}</span><b>{pos?.speed_m_s?.toFixed(2) ?? '—'}</b><small>m/s</small></div>
        <div><span>{t('Máx. (2 min)', 'Max (2 min)')}</span><b>{pos?.max_distance_m.toFixed(1) ?? '—'}</b><small>m</small></div>
      </article>
      {showCrew && crew.length > 0 && <article className="eva-crew">
        <span>{t('TRIPULACIÓN EN LA ESCENA', 'CREW IN THE SCENE')}</span>
        {crew.map(c => {
          const info = crewInfo(c.astronaut_id)
          return <div key={c.astronaut_id} className={c.astronaut_id === astronautId ? 'me' : ''}>
            <i style={{ background: info?.accent }} />
            <b>{info?.shortName ?? c.astronaut_id}</b>
            <em style={{ color: ZONE[c.zone].color }}>{c.distance_m.toFixed(1)} m · {zoneText(c.zone).label}</em>
            <small className={c.source !== 'simulation' ? 'real' : ''}>{srcTag(c.source)}</small>
          </div>
        })}
      </article>}
      <article className="eva-phone">
        <span>{t('FUENTE DE POSICIÓN', 'POSITION SOURCE')}</span>
        <p>{t('Elige el sensor preferido. Si no tiene datos (o el MPU6050 se desboca a más de 40 m), se usa el otro; si ninguno envía, la simulación.', 'Pick the preferred sensor. If it has no data (or the MPU6050 drifts beyond 40 m), the other one is used; if neither sends, the simulation.')}</p>
        <PhoneControls astronautId={astronautId} />
      </article>
      <article className="eva-note">
        <span>{t('CÓMO SE MIDE', 'HOW IT IS MEASURED')}</span>
        <p>{t('El punto 0 es el centro de la cápsula (cabina de ~2 × 2 m): a 2 m o menos de ese punto el astronauta está dentro; más lejos, está fuera. El ESP32 estima X, Y y Z integrando el acelerómetro MPU6050 desde ese punto (el botón «Restablecer posición cero» de su página lo vuelve a 0) y lo envía a Supabase una vez por segundo.', 'Point 0 is the centre of the capsule (~2 × 2 m cabin): within 2 m of that point the astronaut is inside; further away, outside. The ESP32 estimates X, Y and Z by integrating the MPU6050 accelerometer from that point (the «Reset zero position» button on its page sets it back to 0) and sends it to Supabase once per second.')}</p>
        <p>{t('Integrar la aceleración acumula error con el tiempo: es una', 'Integrating acceleration builds up error over time: it is an')} <b>{t('estimación', 'estimate')}</b>. {t('Una misión real lo combinaría con balizas de radio (UWB) en la cápsula.', 'A real mission would combine it with radio beacons (UWB) on the capsule.')}</p>
      </article>
    </div>
  </section>
}
