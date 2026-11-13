// Envoltorio de fetch para /api: si el servidor responde 401 (sesión vencida o sin
// contraseña), avisa a LoginGate para que vuelva a mostrar la pantalla de acceso.
export const UNAUTHORIZED_EVENT = 'stellar-unauthorized'

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, { credentials: 'same-origin', ...init })
  if (response.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  return response
}
