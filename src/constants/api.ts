const PRODUCTION_API_URL = 'https://aseada-backend.vercel.app';
const isLocalWeb = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

export const API_URL = process.env.EXPO_PUBLIC_API_URL || (isLocalWeb ? 'http://localhost:3000' : PRODUCTION_API_URL);

export const api = {
  post: async (endpoint: string, body: any, token?: string) => {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error de API (${res.status})`);
    return data;
  },
  get: async (endpoint: string, token?: string) => {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_URL}${endpoint}`, { headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error de API (${res.status})`);
    return data;
  }
};
