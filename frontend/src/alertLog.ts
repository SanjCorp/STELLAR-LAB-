import { useEffect, useState } from 'react'
import type { Alert } from './health'

/**
 * Seguimiento de alertas en ESTE navegador (no toca la base de datos):
 *  - log: cuándo empezó y terminó cada alerta hoy (para que no "desaparezcan" sin rastro),
 *  - acks: alertas marcadas como "Entendido" (con el nivel que tenían; si sube, vuelven a destacarse),
 *  - checks: pasos de "qué hacer" ya marcados.
 * Se guarda por astronauta en localStorage y se reinicia cada día.
 */
export type LogEntry = { key: string; id: string; title: string; level: number; maxLevel: number; start: number; end: number | null }
type Store = { day: string; log: LogEntry[]; acks: Record<string, number>; checks: Record<string, number[]> }

const REOPEN_MS = 30_000
const lastOf = <T,>(list: T[], ok: (x: T) => boolean) => [...list].reverse().find(ok)
const today = () => new Date().toDateString()
const empty = (): Store => ({ day: today(), log: [], acks: {}, checks: {} })
const storageKey = (id: string) => `stellar-alerts-${id}`

function load(id: string): Store {
  try {
    const s = JSON.parse(localStorage.getItem(storageKey(id)) ?? '') as Store
    if (s && s.day === today() && Array.isArray(s.log)) return { ...empty(), ...s }
  } catch { /* sin datos */ }
  return empty()
}
function save(id: string, s: Store) {
  try { localStorage.setItem(storageKey(id), JSON.stringify(s)) } catch { /* sin almacenamiento */ }
}

export type AlertTracker = {
  log: LogEntry[]; acks: Record<string, number>; checks: Record<string, number[]>
  since: (id: string) => number | null
  isAcked: (a: Alert) => boolean
  ack: (a: Alert) => void; unack: (id: string) => void; toggleCheck: (id: string, step: number) => void
}

/** `owner` = astronauta al que pertenecen las `alerts` (evita mezclar perfiles al cambiar de usuario). */
export function useAlertTracker(astronautId: string | null, alerts: Alert[], owner: string | null): AlertTracker {
  const [store, setStore] = useState<Store>(() => astronautId ? load(astronautId) : empty())

  useEffect(() => { if (astronautId) setStore(load(astronautId)) }, [astronautId])

  useEffect(() => {
    if (!astronautId || owner !== astronautId) return
    setStore(prev => {
      const s: Store = prev.day === today() ? JSON.parse(JSON.stringify(prev)) : empty()
      const now = Date.now()
      const active = alerts.filter(a => a.level >= 1)
      const ids = new Set(active.map(a => a.id))
      for (const a of active) {
        // Si la misma alerta se cerró hace poco (va y viene), se reabre la entrada en vez de crear otra.
        const open = s.log.find(e => e.id === a.id && e.end == null)
          ?? lastOf(s.log, e => e.id === a.id && e.end != null && now - e.end < REOPEN_MS)
        if (open) { open.end = null; open.level = a.level; open.maxLevel = Math.max(open.maxLevel, a.level); open.title = a.title }
        else s.log.push({ key: `${a.id}-${now}`, id: a.id, title: a.title, level: a.level, maxLevel: a.level, start: now, end: null })
      }
      for (const e of s.log) if (e.end == null && !ids.has(e.id)) e.end = now
      // "Entendido" y pasos marcados se olvidan cuando la alerta lleva un rato resuelta.
      for (const id of new Set([...Object.keys(s.acks), ...Object.keys(s.checks)])) {
        const last = lastOf(s.log, e => e.id === id)
        if (!last || (last.end != null && now - last.end >= REOPEN_MS)) { delete s.acks[id]; delete s.checks[id] }
      }
      s.log = s.log.slice(-60)
      save(astronautId, s)
      return s
    })
  }, [alerts, owner, astronautId])

  const update = (fn: (s: Store) => void) => setStore(prev => {
    const s: Store = JSON.parse(JSON.stringify(prev)); fn(s)
    if (astronautId) save(astronautId, s)
    return s
  })

  return {
    ...store,
    since: id => store.log.find(e => e.id === id && e.end == null)?.start ?? null,
    isAcked: a => (store.acks[a.id] ?? -1) >= a.level,
    ack: a => update(s => { s.acks[a.id] = a.level }),
    unack: id => update(s => { delete s.acks[id] }),
    toggleCheck: (id, step) => update(s => {
      const list = new Set(s.checks[id] ?? [])
      if (list.has(step)) list.delete(step); else list.add(step)
      s.checks[id] = [...list]
    }),
  }
}

/** Qué tarjeta de métrica del panel corresponde a cada alerta (para resaltarla). */
export const ALERT_METRIC: Record<string, string[]> = {
  heart: ['hr', 'hr-rr', 'fever-hr'],
  breath: ['rr', 'hr-rr'],
  bp: ['bp-crisis', 'bp-high', 'bp-elev', 'bp-low'],
  temp: ['fever', 'fever-hr', 'temp'],
  ecg: ['signal'],
}
export function metricAlertLevel(metric: string, alerts: Alert[]) {
  const ids = ALERT_METRIC[metric] ?? []
  return Math.max(0, ...alerts.filter(a => a.level >= 1 && ids.includes(a.id)).map(a => a.level))
}
