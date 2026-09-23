const PRODUCTION_API_URL = 'https://aseada-backend.vercel.app';
const isLocalWeb = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

export const API_URL = process.env.EXPO_PUBLIC_API_URL || (isLocalWeb ? 'http://localhost:3000' : PRODUCTION_API_URL);

async function request(method: string, endpoint: string, body?: any, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Error de API (${res.status})`);
  return data;
}

export const api = {
  request,
  post: (endpoint: string, body: any, token?: string) => request('POST', endpoint, body, token),
  get: (endpoint: string, token?: string) => request('GET', endpoint, undefined, token)
};
