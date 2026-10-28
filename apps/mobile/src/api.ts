import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Device, Position, SessionUser } from './types';

const SERVER = (process.env.EXPO_PUBLIC_CARVA_API_URL || 'https://gps.carvarent.com').replace(/\/$/, '');
const SESSION_KEY = 'carva.pulse.user';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SERVER}${path}`, {
    ...init,
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers },
  });
  const body = await response.text();
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { message = JSON.parse(body).error || message; } catch { /* non-JSON response */ }
    throw new ApiError(response.status, message);
  }
  return body ? JSON.parse(body) as T : (undefined as T);
}

export const api = {
  async login(email: string, password: string) {
    const user = await request<SessionUser>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(user));
    return user;
  },
  async session() {
    const user = await request<SessionUser>('/api/auth/session');
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(user));
    return user;
  },
  async cachedUser() {
    const item = await AsyncStorage.getItem(SESSION_KEY);
    return item ? JSON.parse(item) as SessionUser : null;
  },
  async logout() {
    await request('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    await AsyncStorage.removeItem(SESSION_KEY);
  },
  devices: () => request<Device[]>('/api/traccar/devices'),
  positions: () => request<Position[]>('/api/traccar/positions'),
  route: (deviceId: number, from: string, to: string) =>
    request<Position[]>(`/api/traccar/positions?deviceId=${deviceId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  async sendCommand(deviceId: number, type: 'engineResume' | 'engineStop') {
    return request('/api/traccar/commands/send', { method: 'POST', body: JSON.stringify({ deviceId, type }) });
  },
};
