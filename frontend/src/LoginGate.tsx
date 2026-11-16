import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { UNAUTHORIZED_EVENT } from './api'
import { LangSwitch, t, useLang } from './i18n'

type GateState = 'checking' | 'locked' | 'open'

// Pantalla de acceso del equipo. La contraseña se valida en el backend
// (variable APP_PASSWORD); si no está definida, la app entra directo.
export default function LoginGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('checking')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  useLang() // vuelve a dibujar toda la app al cambiar el idioma

  useEffect(() => {
    let alive = true
    fetch('/api/session', { credentials: 'same-origin' })
      .then(res => res.ok ? res.json() : Promise.reject(new Error('session')))
      .then((data: { required: boolean; authenticated: boolean }) => { if (alive) setState(!data.required || data.authenticated ? 'open' : 'locked') })
      .catch(() => { if (alive) setState('open') }) // sin API: la app muestra "API desconectada"
    const lock = () => setState('locked')
    window.addEventListener(UNAUTHORIZED_EVENT, lock)
    return () => { alive = false; window.removeEventListener(UNAUTHORIZED_EVENT, lock) }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!password || sending) return
    setSending(true); setError('')
    try {
      const res = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      if (res.ok) { setPassword(''); setState('open') }
      else setError(res.status === 401 ? t('Contraseña incorrecta.', 'Wrong password.') : t('No se pudo verificar. Intenta de nuevo.', 'Could not verify. Try again.'))
    } catch {
      setError(t('No hay conexión con el servidor.', 'No connection to the server.'))
    } finally {
      setSending(false)
    }
  }

  if (state === 'open') return <>{children}</>

  return <main className="profile-gate">
    <div className="gate-stars"/><div className="gate-orbit orbit-a"/><div className="gate-orbit orbit-b"/>
    <header className="gate-brand"><img className="gate-logo" src="/brand/logo-cian.svg" alt="" /><div><b>STELLAR <em>Health</em></b><span>{t('ACCESO DEL EQUIPO', 'TEAM ACCESS')}</span></div><LangSwitch /></header>
    <section className="profile-picker login-box">
      <span>{t('STELLAR LAB · ACCESO RESTRINGIDO', 'STELLAR LAB · RESTRICTED ACCESS')}</span>
      <h1>{t('Ingresa la contraseña', 'Enter the password')}</h1>
      <p>{t('Esta demo está protegida para el equipo y los evaluadores.', 'This demo is protected for the team and the judges.')}</p>
      {state === 'checking' ? <p className="login-status">{t('Verificando…', 'Checking…')}</p> : <form onSubmit={submit}>
        <input type="password" autoFocus autoComplete="current-password" placeholder={t('Contraseña', 'Password')} aria-label={t('Contraseña', 'Password')} value={password} onChange={e => setPassword(e.target.value)} />
        <button type="submit" disabled={sending || !password}>{sending ? t('Verificando…', 'Checking…') : t('Entrar', 'Sign in')}</button>
        {error && <p className="login-error" role="alert">{error}</p>}
      </form>}
      <div className="gate-note"><i/> {t('Prototipo educativo de demostración. No es un dispositivo médico.', 'Educational demo prototype. Not a medical device.')}</div>
    </section>
  </main>
}
