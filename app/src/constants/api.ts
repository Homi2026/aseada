const PRODUCTION_API_URL = 'https://aseada-backend.vercel.app';
const isLocalWeb = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

export const API_URL = process.env.EXPO_PUBLIC_API_URL || (isLocalWeb ? 'http://localhost:3000' : PRODUCTION_API_URL);

/**
 * Error de la API que conserva el codigo HTTP. Sin el, una sesion vencida (401)
 * llega a la pantalla igual que un fallo de red, y terminamos mostrando
 * "todavia no tienes servicios" a alguien que solo tiene que volver a entrar.
 */
export class ErrorApi extends Error {
  status: number;

  constructor(mensaje: string, status: number) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.status = status;
  }
}

/** El token no existe o el servidor ya no lo acepta: hay que volver al login. */
export const esSesionVencida = (error: any) => error?.status === 401;

/** El servidor entendio quien eres pero no te deja: cuenta en revision, rol equivocado. */
export const esAccesoDenegado = (error: any) => error?.status === 403;

async function request(method: string, endpoint: string, body?: any, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) })
  });
  // El cuerpo se lee como texto primero: un 401 de la pasarela puede venir en
  // HTML, y si res.json() reventara perderiamos el codigo que necesitamos para
  // distinguir sesion vencida de cualquier otro error.
  const texto = await res.text();
  let data: any = null;
  try {
    data = texto ? JSON.parse(texto) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ErrorApi(data?.error || `Error de API (${res.status})`, res.status);
  return data;
}

export const api = {
  request,
  post: (endpoint: string, body: any, token?: string) => request('POST', endpoint, body, token),
  get: (endpoint: string, token?: string) => request('GET', endpoint, undefined, token)
};
