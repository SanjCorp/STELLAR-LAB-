import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { UNAUTHORIZED_EVENT } from './api'

type GateState = 'checking' | 'locked' | 'open'

// Pantalla de acceso del equipo. La contraseña se valida en el backend
// (variable APP_PASSWORD); si no está definida, la app entra directo.
export default function LoginGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('checking')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

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
      else setError(res.status === 401 ? 'Contraseña incorrecta.' : 'No se pudo verificar. Intenta de nuevo.')
    } catch {
      setError('No hay conexión con el servidor.')
    } finally {
      setSending(false)
    }
  }

  if (state === 'open') return <>{children}</>

  return <main className="profile-gate">
    <div className="gate-stars"/><div className="gate-orbit orbit-a"/><div className="gate-orbit orbit-b"/>
    <header className="gate-brand"><div className="mark">S</div><div><b>STELLAR</b><span>CREW HEALTH · ACCESO DEL EQUIPO</span></div></header>
    <section className="profile-picker login-box">
      <span>STELLAR LAB · ACCESO RESTRINGIDO</span>
      <h1>Ingresa la contraseña</h1>
      <p>Esta demo está protegida para el equipo y los evaluadores.</p>
      {state === 'checking' ? <p className="login-status">Verificando…</p> : <form onSubmit={submit}>
        <input type="password" autoFocus autoComplete="current-password" placeholder="Contraseña" aria-label="Contraseña" value={password} onChange={e => setPassword(e.target.value)} />
        <button type="submit" disabled={sending || !password}>{sending ? 'Verificando…' : 'Entrar'}</button>
        {error && <p className="login-error" role="alert">{error}</p>}
      </form>}
      <div className="gate-note"><i/> Prototipo educativo de demostración. No es un dispositivo médico.</div>
    </section>
  </main>
}
