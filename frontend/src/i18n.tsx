import { useSyncExternalStore } from 'react'

// Idioma de la interfaz (ES por defecto). Se guarda en este navegador y se envía al
// backend en el encabezado X-Stellar-Lang para que alertas y reportes salgan en el mismo idioma.
export type Lang = 'es' | 'en'
const KEY = 'stellar-lang'
const listeners = new Set<() => void>()

function initial(): Lang {
  try { const saved = localStorage.getItem(KEY); if (saved === 'es' || saved === 'en') return saved } catch { /* sin almacenamiento */ }
  return 'es'
}
let current: Lang = initial()
document.documentElement.lang = current

export const getLang = () => current
export function setLang(lang: Lang) {
  if (lang === current) return
  current = lang
  document.documentElement.lang = lang
  try { localStorage.setItem(KEY, lang) } catch { /* sin almacenamiento */ }
  listeners.forEach(fn => fn())
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

/** Componente raíz: se vuelve a dibujar al cambiar el idioma (y con él toda la app). */
export function useLang(): Lang { return useSyncExternalStore(subscribe, getLang) }

/** Texto según el idioma actual: t('Hola', 'Hello'). */
export function t(es: string, en: string) { return current === 'en' ? en : es }
export const locale = () => (current === 'en' ? 'en-US' : 'es-ES')

/** Interruptor ES / EN. */
export function LangSwitch({ compact = false }: { compact?: boolean }) {
  const lang = useLang()
  return <div className={`lang-switch ${compact ? 'compact' : ''}`} role="group" aria-label={t('Idioma', 'Language')}>
    <button className={lang === 'es' ? 'on' : ''} aria-pressed={lang === 'es'} onClick={() => setLang('es')}>ES</button>
    <button className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
  </div>
}

// Día de misión calculado (antes estaba escrito a mano como "042").
export const MISSION_START = Date.UTC(2026, 9, 4) // 4 oct 2026 = día 1
export function missionDay(now = Date.now()) {
  return String(Math.max(1, Math.floor((now - MISSION_START) / 86400000) + 1)).padStart(3, '0')
}

/** Etiqueta del nodo: "NODO 1" si el ESP32 está enviando, "SIM" si no. */
export function nodeTag(node: number | undefined, live: boolean) {
  return live ? `${t('NODO', 'NODE')} ${node ?? '?'}` : 'SIM'
}

// Etiquetas que el backend envía como códigos.
export function bpLabel(code?: string | null) {
  return ({ normal: t('normal', 'normal'), elevada: t('elevada', 'elevated'), alta: t('alta', 'high'), baja: t('baja', 'low') } as Record<string, string>)[code ?? ''] ?? (code ?? '')
}
export function tempLabel(code?: string | null) {
  return ({ normal: t('normal', 'normal'), elevada: t('algo elevada', 'slightly high'), fiebre: t('fiebre', 'fever'), baja: t('baja', 'low') } as Record<string, string>)[code ?? ''] ?? (code ?? '')
}
export function roleLabel(role: string) {
  return ({ Commander: t('Comandante', 'Commander'), Pilot: t('Piloto', 'Pilot'), 'Mission Specialist': t('Especialista de misión', 'Mission Specialist'), 'System Administration': t('Equipo médico y técnico', 'Medical & technical team') } as Record<string, string>)[role] ?? role
}
