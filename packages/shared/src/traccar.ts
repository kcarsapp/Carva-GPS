// Minimal typed client for the Traccar REST + WebSocket API.
// Docs: https://www.traccar.org/api-reference/
//
// Traccar uses cookie-session auth (via /api/session) for browser clients,
// or Basic auth / bearer tokens for server-to-server. Our @carva/api will
// usually proxy this; this client is also usable directly for prototyping.

export interface TraccarConfig {
  /** Base URL of the Traccar server, e.g. https://demo.traccar.org */
  baseUrl: string;
  /** Optional bearer token for server-to-server calls. */
  token?: string;
}

export interface TraccarDevice {
  id: number;
  name: string;
  uniqueId: string;
  status: string;
  lastUpdate?: string;
  category?: string;
  groupId?: number;
}

export interface TraccarPosition {
  id: number;
  deviceId: number;
  deviceTime: string;
  fixTime: string;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  course: number;
  address?: string;
  accuracy?: number;
  attributes: Record<string, unknown>;
}

export class TraccarClient {
  constructor(private readonly config: TraccarConfig) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json', ...extra };
    if (this.config.token) h.Authorization = `Bearer ${this.config.token}`;
    return h;
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, '')}/api${path}`;
  }

  /** Create a session (cookie auth) — for browser/prototyping use. */
  async login(email: string, password: string): Promise<void> {
    const body = new URLSearchParams({ email, password });
    const res = await fetch(this.url('/session'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body,
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Traccar login failed: ${res.status}`);
  }

  async getDevices(): Promise<TraccarDevice[]> {
    const res = await fetch(this.url('/devices'), {
      headers: this.headers(),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`getDevices failed: ${res.status}`);
    return res.json();
  }

  /** Latest known positions for all (or given) devices. */
  async getPositions(): Promise<TraccarPosition[]> {
    const res = await fetch(this.url('/positions'), {
      headers: this.headers(),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`getPositions failed: ${res.status}`);
    return res.json();
  }

  /** Historical route for a device in a time range. */
  async getRoute(deviceId: number, from: string, to: string): Promise<TraccarPosition[]> {
    const qs = new URLSearchParams({ deviceId: String(deviceId), from, to });
    const res = await fetch(this.url(`/positions?${qs}`), {
      headers: this.headers(),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`getRoute failed: ${res.status}`);
    return res.json();
  }

  /**
   * Live updates socket. Traccar pushes { devices, positions, events }.
   * Pass the ws(s):// URL; auth relies on the session cookie established by login().
   */
  connectSocket(
    onMessage: (data: { devices?: TraccarDevice[]; positions?: TraccarPosition[] }) => void,
    onError?: (e: unknown) => void,
  ): { close: () => void } {
    const wsUrl = this.config.baseUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/api/socket';
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data));
      } catch (e) {
        onError?.(e);
      }
    };
    ws.onerror = (e) => onError?.(e);
    return { close: () => ws.close() };
  }
}
