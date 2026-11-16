import { getLang } from './i18n'

// Envoltorio de fetch para /api: si el servidor responde 401 (sesión vencida o sin
// contraseña), avisa a LoginGate para que vuelva a mostrar la pantalla de acceso.
// También envía el idioma elegido para que el backend redacte alertas y reportes en ese idioma.
export const UNAUTHORIZED_EVENT = 'stellar-unauthorized'

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set('X-Stellar-Lang', getLang())
  const response = await fetch(input, { credentials: 'same-origin', ...init, headers })
  if (response.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  return response
}
