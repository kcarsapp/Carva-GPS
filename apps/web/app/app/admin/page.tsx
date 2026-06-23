'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AccountType, TraccarDevice } from '@carva/shared';
import {
  ACCOUNT_TYPE_LABELS,
  isCompany,
  newCompanyPayload,
  toCompany,
  type Company,
  type TraccarUserRecord,
} from '@/lib/companies';
import './admin.css';

const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[];
const CATEGORIES = ['car', 'truck', 'bus', 'motorcycle', 'scooter', 'asset'];

async function jsonOrThrow(res: Response) {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const msg =
      (data as { message?: string } | null)?.message || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [devices, setDevices] = useState<TraccarDevice[]>([]);
  const [deviceCompany, setDeviceCompany] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);

  // New-company form.
  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPassword, setCPassword] = useState('');
  const [cType, setCType] = useState<AccountType>('logistics');
  const [cLimit, setCLimit] = useState('-1');
  const [cBusy, setCBusy] = useState(false);

  // Add-GPS form.
  const [dName, setDName] = useState('');
  const [dImei, setDImei] = useState('');
  const [dCategory, setDCategory] = useState('car');
  const [dCompany, setDCompany] = useState<string>('');
  const [dBusy, setDBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const users = (await jsonOrThrow(
        await fetch('/api/traccar/users'),
      )) as TraccarUserRecord[];
      const comps = users.filter(isCompany).map(toCompany);
      setCompanies(comps);

      const allDevices = (await jsonOrThrow(
        await fetch('/api/traccar/devices?all=true'),
      )) as TraccarDevice[];
      setDevices(allDevices);

      // Map each device to the company that can access it.
      const map: Record<number, number> = {};
      for (const c of comps) {
        const owned = (await jsonOrThrow(
          await fetch(`/api/traccar/devices?userId=${c.id}`),
        )) as TraccarDevice[];
        for (const d of owned) map[d.id] = c.id;
      }
      setDeviceCompany(map);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Admin gate + initial load.
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        if (!alive) return;
        if (!u) return router.replace('/login');
        if (!u.administrator) return router.replace('/app');
        setReady(true);
        load();
      })
      .catch(() => router.replace('/login'));
    return () => {
      alive = false;
    };
  }, [router, load]);

  async function createCompany(e: React.FormEvent) {
    e.preventDefault();
    setCBusy(true);
    setError(null);
    try {
      await jsonOrThrow(
        await fetch('/api/traccar/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            newCompanyPayload({
              name: cName,
              email: cEmail,
              password: cPassword,
              accountType: cType,
              deviceLimit: Number(cLimit),
            }),
          ),
        }),
      );
      setCName('');
      setCEmail('');
      setCPassword('');
      setCLimit('-1');
      await load();
    } catch (e) {
      setError(`Couldn’t create company: ${(e as Error).message}`);
    } finally {
      setCBusy(false);
    }
  }

  async function addGps(e: React.FormEvent) {
    e.preventDefault();
    setDBusy(true);
    setError(null);
    try {
      const device = (await jsonOrThrow(
        await fetch('/api/traccar/devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: dName, uniqueId: dImei, category: dCategory }),
        }),
      )) as TraccarDevice;
      if (dCompany) {
        await jsonOrThrow(
          await fetch('/api/traccar/permissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: Number(dCompany), deviceId: device.id }),
          }),
        );
      }
      setDName('');
      setDImei('');
      await load();
    } catch (e) {
      setError(`Couldn’t add device: ${(e as Error).message}`);
    } finally {
      setDBusy(false);
    }
  }

  async function assign(deviceId: number, companyId: number) {
    setError(null);
    const prev = deviceCompany[deviceId];
    try {
      if (prev && prev !== companyId) {
        await fetch('/api/traccar/permissions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: prev, deviceId }),
        });
      }
      if (companyId) {
        await jsonOrThrow(
          await fetch('/api/traccar/permissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: companyId, deviceId }),
          }),
        );
      }
      await load();
    } catch (e) {
      setError(`Couldn’t reassign device: ${(e as Error).message}`);
    }
  }

  const deviceCount = (companyId: number) =>
    Object.values(deviceCompany).filter((id) => id === companyId).length;

  if (!ready) return <div className="admin-loading">Loading admin…</div>;

  return (
    <div className="admin">
      <header className="admin-head">
        <a className="brand" href="/app">
          <span className="dot" /> Carva GPS
        </a>
        <div className="admin-title">Super-admin · Companies &amp; devices</div>
        <a className="back" href="/app">← Live map</a>
      </header>

      {error && <div className="admin-err">{error}</div>}

      <div className="admin-grid">
        {/* Companies */}
        <section className="panel">
          <h2>Companies</h2>
          <form className="form" onSubmit={createCompany}>
            <div className="form-row">
              <input placeholder="Company name" value={cName} onChange={(e) => setCName(e.target.value)} required />
              <select value={cType} onChange={(e) => setCType(e.target.value as AccountType)}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <input type="email" placeholder="Login email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} required />
              <input type="text" placeholder="Password" value={cPassword} onChange={(e) => setCPassword(e.target.value)} required />
            </div>
            <div className="form-row">
              <input type="number" placeholder="Device limit (-1 = unlimited)" value={cLimit} onChange={(e) => setCLimit(e.target.value)} />
              <button type="submit" disabled={cBusy}>{cBusy ? 'Creating…' : '+ Create company'}</button>
            </div>
          </form>

          {companies.length === 0 ? (
            <p className="muted">No companies yet. Create one above.</p>
          ) : (
            <ul className="list">
              {companies.map((c) => (
                <li key={c.id} className="company">
                  <div>
                    <div className="company-name">{c.name}</div>
                    <div className="company-sub">
                      {ACCOUNT_TYPE_LABELS[c.accountType]} · {c.email}
                    </div>
                  </div>
                  <span className="badge">{deviceCount(c.id)} cars</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Devices */}
        <section className="panel">
          <h2>GPS devices</h2>
          <form className="form" onSubmit={addGps}>
            <div className="form-row">
              <input placeholder="Device name (e.g. Van 12)" value={dName} onChange={(e) => setDName(e.target.value)} required />
              <input placeholder="IMEI / unique id" value={dImei} onChange={(e) => setDImei(e.target.value)} required />
            </div>
            <div className="form-row">
              <select value={dCategory} onChange={(e) => setDCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={dCompany} onChange={(e) => setDCompany(e.target.value)}>
                <option value="">— assign to company —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="submit" disabled={dBusy}>{dBusy ? 'Adding…' : '+ Add GPS'}</button>
            </div>
          </form>

          {devices.length === 0 ? (
            <p className="muted">No devices yet.</p>
          ) : (
            <ul className="list">
              {devices.map((d) => (
                <li key={d.id} className="device-row">
                  <div>
                    <div className="company-name">{d.name}</div>
                    <div className="company-sub">{d.uniqueId} · {d.status}</div>
                  </div>
                  <select
                    value={deviceCompany[d.id] ?? ''}
                    onChange={(e) => assign(d.id, Number(e.target.value))}
                  >
                    <option value="">Unassigned</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
