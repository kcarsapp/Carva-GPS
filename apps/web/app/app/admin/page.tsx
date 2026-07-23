'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AccountType, TraccarDevice, TraccarPosition } from '@carva/shared';
import {
  ACCOUNT_TYPE_LABELS,
  CARVA_ACCOUNT_TYPE,
  newCompanyPayload,
  type TraccarUserRecord,
} from '@/lib/companies';
import {
  DEVICE_CATEGORIES,
  TRACKER_PRESETS,
  normalizeUniqueId,
  parseBulkDevices,
  presetFor,
  uniqueIdIssue,
} from '@/lib/devices';
import {
  CARVA_CAPS,
  withCapOverride,
  type CapKey,
  type CapOverrides,
} from '@/lib/capabilities';
import { useI18n, LanguageSwitcher } from '@/lib/i18n-provider';
import './admin.css';

const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[];
const CATEGORIES = DEVICE_CATEGORIES;

/** localStorage key for the SMS-setup card's server host/port/APN. */
const SMS_SETUP_KEY = 'carva-sms-setup';

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

type Role = 'admin' | 'company' | 'personal';

function roleOf(u: TraccarUserRecord): Role {
  if (u.administrator) return 'admin';
  const a = u.attributes ?? {};
  if (a['carvaKind'] === 'company' || a['accountType'] === 'company') return 'company';
  return 'personal';
}

function accountTypeOf(u: TraccarUserRecord): AccountType {
  const a = u.attributes ?? {};
  const t = (a[CARVA_ACCOUNT_TYPE] ?? a['accountType']) as string | undefined;
  return ACCOUNT_TYPES.includes(t as AccountType) ? (t as AccountType) : 'personal';
}

/** Format a Traccar timestamp in Iraq time (Asia/Baghdad). */
function fmtTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Asia/Baghdad',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function AdminPage() {
  const router = useRouter();
  const { t } = useI18n();
  const acctLabel = (type: AccountType) => t(`acct.${type}.title`);
  const [ready, setReady] = useState(false);
  const [meId, setMeId] = useState<number | null>(null);
  const [tab, setTab] = useState<'accounts' | 'gps'>('accounts');
  const [error, setError] = useState<string | null>(null);

  // Data.
  const [users, setUsers] = useState<TraccarUserRecord[]>([]);
  const [devices, setDevices] = useState<TraccarDevice[]>([]);
  const [positions, setPositions] = useState<Record<number, TraccarPosition>>({});
  const [deviceOwner, setDeviceOwner] = useState<Record<number, number>>({});

  // Accounts tab.
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [userDevices, setUserDevices] = useState<TraccarDevice[]>([]);

  // Editor form (mirrors the selected user).
  const [fName, setFName] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fPassword, setFPassword] = useState('');
  const [fCompany, setFCompany] = useState('');
  const [fType, setFType] = useState<AccountType>('personal');
  const [fLimit, setFLimit] = useState('');
  const [fDisabled, setFDisabled] = useState(false);
  const [fAdmin, setFAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [assignPick, setAssignPick] = useState('');

  // New-account form.
  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPassword, setCPassword] = useState('');
  const [cCompany, setCCompany] = useState('');
  const [cType, setCType] = useState<AccountType>('personal');
  const [cLimit, setCLimit] = useState('');
  const [cBusy, setCBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // Add-GPS form.
  const [dName, setDName] = useState('');
  const [dImei, setDImei] = useState('');
  const [dPhone, setDPhone] = useState('');
  const [dCategory, setDCategory] = useState('car');
  const [dModel, setDModel] = useState('');
  const [dOwner, setDOwner] = useState<string>('');
  const [dBusy, setDBusy] = useState(false);

  // Bulk add.
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkOwner, setBulkOwner] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResults, setBulkResults] = useState<
    { name: string; ok: boolean; msgKey?: string; msg?: string }[]
  >([]);

  // Device-list search/filter.
  const [gpsQuery, setGpsQuery] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(false);

  // Per-device capability override card.
  const [capsFor, setCapsFor] = useState<number | null>(null);
  const [capBusy, setCapBusy] = useState(false);

  // SMS setup card (per-device expandable; server details persist locally).
  const [smsFor, setSmsFor] = useState<number | null>(null);
  const [smsHost, setSmsHost] = useState('');
  const [smsApn, setSmsApn] = useState('');
  const [smsModel, setSmsModel] = useState(TRACKER_PRESETS[0].model);
  // Manual port overrides, keyed by model; presets fill the gaps.
  const [smsPorts, setSmsPorts] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  // State (not a ref) on purpose: the save effect must skip the mount-time run,
  // which still closes over pre-load values — a ref flips too early for that.
  const [smsLoaded, setSmsLoaded] = useState(false);

  const smsPort = smsPorts[smsModel] ?? presetFor(smsModel)?.port ?? '5015';

  const selected = useMemo(
    () => users.find((u) => u.id === selectedId) ?? null,
    [users, selectedId],
  );
  const nonAdminUsers = useMemo(() => users.filter((u) => !u.administrator), [users]);

  const load = useCallback(async () => {
    try {
      const allUsers = (await jsonOrThrow(
        await fetch('/api/traccar/users'),
      )) as TraccarUserRecord[];
      setUsers(allUsers);

      const allDevices = (await jsonOrThrow(
        await fetch('/api/traccar/devices?all=true'),
      )) as TraccarDevice[];
      setDevices(allDevices);

      // Latest positions (best effort — map deviceId → position).
      try {
        const pos = (await jsonOrThrow(
          await fetch('/api/traccar/positions'),
        )) as TraccarPosition[];
        const pmap: Record<number, TraccarPosition> = {};
        for (const p of pos) pmap[p.deviceId] = p;
        setPositions(pmap);
      } catch {
        /* positions are optional enrichment */
      }

      // Map each device to the account that can access it.
      const map: Record<number, number> = {};
      for (const u of allUsers.filter((x) => !x.administrator)) {
        try {
          const owned = (await jsonOrThrow(
            await fetch(`/api/traccar/devices?userId=${u.id}`),
          )) as TraccarDevice[];
          for (const d of owned) map[d.id] = u.id;
        } catch {
          /* user with no access */
        }
      }
      setDeviceOwner(map);
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
        setMeId(u.id ?? null);
        setReady(true);
        load();
      })
      .catch(() => router.replace('/login'));
    return () => {
      alive = false;
    };
  }, [router, load]);

  // Sync the editor + device list whenever a user is selected.
  useEffect(() => {
    if (!selected) return;
    setFName(selected.name ?? '');
    setFEmail(selected.email ?? '');
    setFPassword('');
    setFCompany(String(selected.attributes?.['companyName'] ?? ''));
    setFType(accountTypeOf(selected));
    // Unlimited is stored as -1 in Traccar; show it as an empty field instead.
    const lim = selected.deviceLimit ?? -1;
    setFLimit(lim < 0 ? '' : String(lim));
    setFDisabled(Boolean(selected.disabled));
    setFAdmin(Boolean(selected.administrator));
    setSavedTick(false);
    setAssignPick('');

    if (selected.administrator) {
      // Admins implicitly see everything; skip the per-user query.
      setUserDevices([]);
      return;
    }
    let alive = true;
    fetch(`/api/traccar/devices?userId=${selected.id}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => alive && setUserDevices(d as TraccarDevice[]))
      .catch(() => alive && setUserDevices([]));
    return () => {
      alive = false;
    };
  }, [selected]);

  // SMS-setup defaults: saved settings win; else prefill host from the server env.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SMS_SETUP_KEY) ?? 'null') as {
        host?: string;
        port?: string; // legacy single-port shape
        apn?: string;
        model?: string;
        ports?: Record<string, string>;
      } | null;
      if (saved?.host) setSmsHost(saved.host);
      if (saved?.apn) setSmsApn(saved.apn);
      if (saved?.model && presetFor(saved.model)) setSmsModel(presetFor(saved.model)!.model);
      if (saved?.ports) setSmsPorts(saved.ports);
      // Migrate the pre-model shape: a lone port was an override for the default model.
      else if (saved?.port && saved.port !== presetFor(TRACKER_PRESETS[0].model)?.port) {
        setSmsPorts({ [saved?.model ?? TRACKER_PRESETS[0].model]: saved.port });
      }
      if (saved?.host) {
        setSmsLoaded(true);
        return;
      }
    } catch {
      /* corrupt localStorage — fall through to server default */
    }
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { trackerHost?: string } | null) => {
        if (c?.trackerHost) setSmsHost((h) => h || c.trackerHost!);
      })
      .catch(() => {})
      .finally(() => {
        setSmsLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (!smsLoaded) return; // don't clobber saved settings before they load
    localStorage.setItem(
      SMS_SETUP_KEY,
      JSON.stringify({ host: smsHost, apn: smsApn, model: smsModel, ports: smsPorts }),
    );
  }, [smsLoaded, smsHost, smsApn, smsModel, smsPorts]);

  /** Lowercased unique ids of every registered device (duplicate checks). */
  const existingIds = useMemo(
    () => new Set(devices.map((d) => d.uniqueId.toLowerCase())),
    [devices],
  );

  const dIdIssue = useMemo(
    () => (dImei.trim() ? uniqueIdIssue(dImei, existingIds) : null),
    [dImei, existingIds],
  );

  const bulkRows = useMemo(
    () => (showBulk ? parseBulkDevices(bulkText, existingIds) : []),
    [showBulk, bulkText, existingIds],
  );
  const bulkReady = useMemo(
    () => bulkRows.filter((r) => !r.issue || r.issue.level !== 'error'),
    [bulkRows],
  );

  const visibleDevices = useMemo(() => {
    const q = gpsQuery.trim().toLowerCase();
    return devices.filter((d) => {
      if (unassignedOnly && deviceOwner[d.id]) return false;
      if (!q) return true;
      const owner = users.find((u) => u.id === deviceOwner[d.id]);
      return (
        d.name.toLowerCase().includes(q) ||
        d.uniqueId.toLowerCase().includes(q) ||
        (d.phone ?? '').toLowerCase().includes(q) ||
        Boolean(
          owner &&
            ((owner.name ?? '').toLowerCase().includes(q) ||
              (owner.email ?? '').toLowerCase().includes(q)),
        )
      );
    });
  }, [devices, gpsQuery, unassignedOnly, deviceOwner, users]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        String(u.attributes?.['companyName'] ?? '')
          .toLowerCase()
          .includes(q),
    );
  }, [users, query]);

  async function saveUser(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError(null);
    setSavedTick(false);
    try {
      const attributes: Record<string, unknown> = {
        ...(selected.attributes ?? {}),
        [CARVA_ACCOUNT_TYPE]: fType,
      };
      if (fCompany.trim()) attributes['companyName'] = fCompany.trim();
      else delete attributes['companyName'];

      const payload: Record<string, unknown> = {
        ...selected,
        name: fName.trim(),
        email: fEmail.trim(),
        deviceLimit: fLimit.trim() === '' ? -1 : Number(fLimit),
        disabled: fDisabled,
        administrator: fAdmin,
        attributes,
      };
      if (fPassword) payload['password'] = fPassword;
      else delete payload['password'];

      await jsonOrThrow(
        await fetch(`/api/traccar/users/${selected.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      );
      setFPassword('');
      setSavedTick(true);
      await load();
    } catch (e) {
      setError(`${t('admin.updateErr')} ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser() {
    if (!selected) return;
    if (!window.confirm(t('admin.confirmDelete'))) return;
    setError(null);
    try {
      const res = await fetch(`/api/traccar/users/${selected.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSelectedId(null);
      await load();
    } catch (e) {
      setError(`${t('admin.deleteErr')} ${(e as Error).message}`);
    }
  }

  async function assignDevice(userId: number, deviceId: number) {
    setError(null);
    try {
      const prev = deviceOwner[deviceId];
      if (prev && prev !== userId) {
        await fetch('/api/traccar/permissions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: prev, deviceId }),
        });
      }
      await jsonOrThrow(
        await fetch('/api/traccar/permissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, deviceId }),
        }),
      );
      await load();
      if (selected && !selected.administrator) {
        const owned = (await jsonOrThrow(
          await fetch(`/api/traccar/devices?userId=${selected.id}`),
        )) as TraccarDevice[];
        setUserDevices(owned);
      }
    } catch (e) {
      setError(`${t('admin.reassignErr')} ${(e as Error).message}`);
    }
  }

  async function removeDevice(userId: number, deviceId: number) {
    setError(null);
    try {
      const res = await fetch('/api/traccar/permissions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, deviceId }),
      });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      setUserDevices((ds) => ds.filter((d) => d.id !== deviceId));
      await load();
    } catch (e) {
      setError(`${t('admin.reassignErr')} ${(e as Error).message}`);
    }
  }

  // Force a capability on/off for a device (null = back to auto-detect).
  async function setCap(d: TraccarDevice, key: CapKey, value: boolean | null) {
    setCapBusy(true);
    setError(null);
    try {
      const attributes = withCapOverride(d.attributes, key, value);
      await jsonOrThrow(
        await fetch(`/api/traccar/devices/${d.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...d, attributes }),
        }),
      );
      await load();
    } catch (e) {
      setError(`${t('admin.caps.err')} ${(e as Error).message}`);
    } finally {
      setCapBusy(false);
    }
  }

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setCBusy(true);
    setError(null);
    try {
      const payload = newCompanyPayload({
        name: cName,
        email: cEmail,
        password: cPassword,
        accountType: cType,
        deviceLimit: cLimit.trim() === '' ? -1 : Number(cLimit),
      }) as Record<string, unknown>;
      if (cCompany.trim()) {
        (payload.attributes as Record<string, unknown>)['companyName'] = cCompany.trim();
      }
      await jsonOrThrow(
        await fetch('/api/traccar/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      );
      setCName('');
      setCEmail('');
      setCPassword('');
      setCCompany('');
      setCLimit('');
      setShowCreate(false);
      await load();
    } catch (e) {
      setError(`${t('admin.createErr')} ${(e as Error).message}`);
    } finally {
      setCBusy(false);
    }
  }

  async function addGps(e: React.FormEvent) {
    e.preventDefault();
    if (dIdIssue?.level === 'error') return;
    setDBusy(true);
    setError(null);
    try {
      const device = (await jsonOrThrow(
        await fetch('/api/traccar/devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: dName.trim(),
            uniqueId: normalizeUniqueId(dImei),
            category: dCategory,
            phone: dPhone.trim() || undefined,
            model: dModel || undefined,
          }),
        }),
      )) as TraccarDevice;
      // The device now exists — an assignment failure must not look like a
      // failed create (retrying would just hit the duplicate-IMEI error).
      if (dOwner) {
        try {
          await jsonOrThrow(
            await fetch('/api/traccar/permissions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: Number(dOwner), deviceId: device.id }),
            }),
          );
        } catch (e2) {
          setError(`${t('admin.addAssignErr')} ${(e2 as Error).message}`);
        }
      }
      setDName('');
      setDImei('');
      setDPhone('');
      setDModel('');
      await load();
    } catch (e) {
      setError(`${t('admin.addErr')} ${(e as Error).message}`);
    } finally {
      setDBusy(false);
    }
  }

  async function bulkAdd(e: React.FormEvent) {
    e.preventDefault();
    if (bulkReady.length === 0) return;
    setBulkBusy(true);
    setError(null);
    const results: { name: string; ok: boolean; msgKey?: string; msg?: string }[] = [];
    for (const row of bulkReady) {
      try {
        const device = (await jsonOrThrow(
          await fetch('/api/traccar/devices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: row.name,
              uniqueId: row.uniqueId,
              category: row.category,
              phone: row.phone,
              model: row.model,
            }),
          }),
        )) as TraccarDevice;
        if (bulkOwner) {
          try {
            await jsonOrThrow(
              await fetch('/api/traccar/permissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: Number(bulkOwner), deviceId: device.id }),
              }),
            );
            results.push({ name: row.name, ok: true, msgKey: 'admin.bulk.added' });
          } catch {
            results.push({ name: row.name, ok: false, msgKey: 'admin.bulk.assignFail' });
          }
        } else {
          results.push({ name: row.name, ok: true, msgKey: 'admin.bulk.added' });
        }
      } catch (e1) {
        results.push({ name: row.name, ok: false, msg: (e1 as Error).message });
      }
    }
    setBulkResults(results);
    if (results.every((r) => r.ok)) setBulkText('');
    await load();
    setBulkBusy(false);
  }

  function copyText(id: string, text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(id);
        setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
      })
      .catch(() => {});
  }

  const deviceCount = (userId: number) =>
    Object.values(deviceOwner).filter((id) => id === userId).length;

  const assignable = useMemo(
    () => devices.filter((d) => !userDevices.some((ud) => ud.id === d.id)),
    [devices, userDevices],
  );

  function DeviceInfo({ d }: { d: TraccarDevice }) {
    const p = positions[d.id];
    return (
      <div className="device-info">
        <div className="device-info-top">
          <span className={`status-dot ${d.status === 'online' ? 'on' : 'off'}`} />
          <span className="company-name">{d.name}</span>
          <span className="device-imei">{d.uniqueId}</span>
        </div>
        <div className="company-sub">
          {d.category ?? 'car'}
          {d.model ? ` · ${d.model}` : ''} · {d.status} · {t('detail.lastSeen')}{' '}
          {fmtTime(d.lastUpdate)}
          {d.phone ? ` · 📱 ${d.phone}` : ''}
        </div>
        <div className="company-sub">
          {p ? (
            <>
              📍 {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)} ·{' '}
              {Math.round(p.speed * 1.852)} {t('dash.kph')}
              {p.address ? ` · ${p.address}` : ''}
              {' · '}
              <a className="map-link" href={`/fleet?device=${d.id}`}>
                {t('admin.viewMap')} ↗
              </a>
            </>
          ) : (
            t('admin.noPos')
          )}
        </div>
      </div>
    );
  }

  // Per-device feature overrides. Each capability is tri-state: Auto (defer to
  // live detection from Traccar), or forced On / Off.
  function CapsCard({ d }: { d: TraccarDevice }) {
    const raw = d.attributes?.[CARVA_CAPS];
    const ov: CapOverrides = raw && typeof raw === 'object' ? (raw as CapOverrides) : {};
    const keys: CapKey[] = ['killSwitch', 'obd', 'acc'];
    const options: { label: string; value: boolean | null }[] = [
      { label: t('admin.caps.auto'), value: null },
      { label: t('admin.caps.on'), value: true },
      { label: t('admin.caps.off'), value: false },
    ];
    return (
      <div className="sms-card">
        <div className="sms-title">{t('admin.caps.title')}</div>
        <p className="sms-hint">{t('admin.caps.hint')}</p>
        {keys.map((k) => {
          const current = ov[k] ?? null;
          return (
            <div key={k} className="caps-row">
              <span className="caps-label">{t(`admin.caps.${k}`)}</span>
              <div className="caps-seg">
                {options.map((o) => (
                  <button
                    key={String(o.value)}
                    type="button"
                    disabled={capBusy}
                    className={current === o.value ? 'active' : ''}
                    onClick={() => setCap(d, k, o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // SMS commands that point a MiCODUS-style tracker at our Traccar server.
  // The model picker sets the Traccar protocol port; SERVER: 0 = IP, 1 = domain.
  function SmsCard({ d }: { d: TraccarDevice }) {
    const host = smsHost.trim();
    const port = smsPort.trim() || '5015';
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    const cmds = [
      `APN,${smsApn.trim() || 'internet'}#`,
      `SERVER,${isIp ? '0' : '1'},${host || 'gps.example.com'},${port}#`,
      'GMT,E,3#',
      'PARAM#',
    ];
    const portsByProtocol = TRACKER_PRESETS.reduce<Record<string, string[]>>((acc, p) => {
      (acc[`${p.port} (${p.protocol})`] ??= []).push(p.model);
      return acc;
    }, {});
    return (
      <div className="sms-card">
        <div className="sms-title">{t('admin.sms.title')}</div>
        <div className="form-row">
          <label className="field">
            <span>{t('admin.sms.model')}</span>
            <select value={smsModel} onChange={(e) => setSmsModel(e.target.value)}>
              {TRACKER_PRESETS.map((p) => (
                <option key={p.model} value={p.model}>
                  {p.model}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('admin.sms.host')}</span>
            <input
              value={smsHost}
              onChange={(e) => setSmsHost(e.target.value)}
              placeholder="1.2.3.4 / gps.example.com"
            />
          </label>
          <label className="field">
            <span>{t('admin.sms.port')}</span>
            <input
              value={smsPort}
              onChange={(e) =>
                setSmsPorts((p) => ({ ...p, [smsModel]: e.target.value }))
              }
              inputMode="numeric"
              placeholder="5015"
            />
          </label>
          <label className="field">
            <span>{t('admin.sms.apn')}</span>
            <input
              value={smsApn}
              onChange={(e) => setSmsApn(e.target.value)}
              placeholder="internet"
            />
          </label>
        </div>
        <div className="sms-send">
          {d.phone
            ? t('admin.sms.send').replace('{phone}', d.phone)
            : t('admin.sms.sendNoPhone')}
        </div>
        {cmds.map((c, i) => (
          <div key={i} className="sms-cmd">
            <code>{c}</code>
            <button
              type="button"
              className="btn-ghost btn-small"
              onClick={() => copyText(`${d.id}:${i}`, c)}
            >
              {copied === `${d.id}:${i}` ? t('admin.sms.copied') : t('admin.sms.copy')}
            </button>
          </div>
        ))}
        <div className="sms-actions">
          <button
            type="button"
            className="btn-small"
            onClick={() => copyText(`${d.id}:all`, cmds.join('\n'))}
          >
            {copied === `${d.id}:all` ? t('admin.sms.copied') : t('admin.sms.copyAll')}
          </button>
        </div>
        <p className="sms-hint sms-ports">
          {Object.entries(portsByProtocol)
            .map(([port, models]) => `${models.join(' / ')} → ${port}`)
            .join('  ·  ')}
        </p>
        <p className="sms-hint">{t('admin.sms.hintPort')}</p>
        <p className="sms-hint">{t('admin.sms.hintApn')}</p>
      </div>
    );
  }

  if (!ready) return <div className="admin-loading">{t('admin.loading')}</div>;

  return (
    <div className="admin admin-wide">
      <header className="admin-head">
        <a className="brand" href="/app">
          <span className="dot" /> Carva GPS
        </a>
        <div className="admin-title">{t('admin.title')}</div>
        <nav className="admin-tabs">
          <button
            className={tab === 'accounts' ? 'active' : ''}
            onClick={() => setTab('accounts')}
          >
            {t('admin.tab.accounts')}
          </button>
          <button className={tab === 'gps' ? 'active' : ''} onClick={() => setTab('gps')}>
            {t('admin.tab.gps')}
          </button>
        </nav>
        <LanguageSwitcher className="lang-select" />
        <a className="back" href="/app">
          {t('admin.backToMap')}
        </a>
      </header>

      {error && <div className="admin-err">{error}</div>}

      {tab === 'accounts' && (
        <div className="admin-cols">
          {/* ── Left: all accounts ─────────────────────────────── */}
          <section className="panel">
            <div className="panel-title-row">
              <h2>{t('admin.accounts')}</h2>
              <button className="btn-small" onClick={() => setShowCreate((v) => !v)}>
                {showCreate ? '×' : t('admin.newAccount')}
              </button>
            </div>

            {showCreate && (
              <form className="form" onSubmit={createAccount}>
                <div className="form-row">
                  <input
                    placeholder={t('admin.fullName')}
                    value={cName}
                    onChange={(e) => setCName(e.target.value)}
                    required
                  />
                  <select
                    value={cType}
                    onChange={(e) => setCType(e.target.value as AccountType)}
                  >
                    {ACCOUNT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {acctLabel(type)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <input
                    placeholder={t('admin.companyNameOpt')}
                    value={cCompany}
                    onChange={(e) => setCCompany(e.target.value)}
                  />
                </div>
                <div className="form-row">
                  <input
                    type="email"
                    placeholder={t('admin.loginEmail')}
                    value={cEmail}
                    onChange={(e) => setCEmail(e.target.value)}
                    required
                  />
                  <input
                    type="text"
                    placeholder={t('admin.password')}
                    value={cPassword}
                    onChange={(e) => setCPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="form-row">
                  <input
                    type="number"
                    min={0}
                    placeholder={t('admin.deviceLimit')}
                    value={cLimit}
                    onChange={(e) => setCLimit(e.target.value)}
                  />
                  <button type="submit" disabled={cBusy}>
                    {cBusy ? t('admin.creating') : t('admin.createUser')}
                  </button>
                </div>
              </form>
            )}

            <input
              className="search"
              placeholder={t('admin.searchUsers')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            {filteredUsers.length === 0 ? (
              <p className="muted">{t('admin.noUsers')}</p>
            ) : (
              <ul className="list">
                {filteredUsers.map((u) => {
                  const role = roleOf(u);
                  return (
                    <li
                      key={u.id}
                      className={`company selectable ${selectedId === u.id ? 'selected' : ''} ${u.disabled ? 'row-disabled' : ''}`}
                      onClick={() => setSelectedId(u.id)}
                    >
                      <div>
                        <div className="company-name">
                          {u.name || u.email}
                          {u.id === meId ? ` (${t('admin.you')})` : ''}
                        </div>
                        <div className="company-sub">
                          {u.email}
                          {u.attributes?.['companyName']
                            ? ` · ${u.attributes['companyName']}`
                            : ''}
                        </div>
                      </div>
                      <div className="row-badges">
                        <span className={`badge role-${role}`}>
                          {t(`admin.role.${role}`)}
                        </span>
                        {!u.administrator && (
                          <span className="badge">
                            {deviceCount(u.id)} {t('admin.cars')}
                          </span>
                        )}
                        {u.disabled && (
                          <span className="badge badge-off">
                            {t('admin.status.disabled')}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ── Right: selected account editor ─────────────────── */}
          <section className="panel">
            {!selected ? (
              <p className="muted">{t('admin.selectUser')}</p>
            ) : (
              <>
                <div className="panel-title-row">
                  <h2>{t('admin.editAccount')}</h2>
                  <span className="muted">
                    {t('admin.userId')}: {selected.id}
                  </span>
                </div>

                <form className="form editor" onSubmit={saveUser}>
                  <label className="field">
                    <span>{t('admin.fullName')}</span>
                    <input value={fName} onChange={(e) => setFName(e.target.value)} required />
                  </label>
                  <label className="field">
                    <span>{t('admin.companyNameOpt')}</span>
                    <input value={fCompany} onChange={(e) => setFCompany(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>{t('admin.loginEmail')}</span>
                    <input
                      type="email"
                      value={fEmail}
                      onChange={(e) => setFEmail(e.target.value)}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>{t('admin.newPassword')}</span>
                    <input
                      type="text"
                      value={fPassword}
                      onChange={(e) => setFPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                  </label>
                  <label className="field">
                    <span>{t('admin.accountType')}</span>
                    <select
                      value={fType}
                      onChange={(e) => setFType(e.target.value as AccountType)}
                    >
                      {ACCOUNT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {acctLabel(type)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>{t('admin.deviceLimit')}</span>
                    <input
                      type="number"
                      min={0}
                      placeholder={t('admin.unlimited')}
                      value={fLimit}
                      onChange={(e) => setFLimit(e.target.value)}
                    />
                  </label>

                  <label className="check">
                    <input
                      type="checkbox"
                      checked={fDisabled}
                      onChange={(e) => setFDisabled(e.target.checked)}
                    />
                    <span>{t('admin.disabledToggle')}</span>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={fAdmin}
                      disabled={selected.id === meId}
                      onChange={(e) => setFAdmin(e.target.checked)}
                    />
                    <span>{t('admin.adminToggle')}</span>
                  </label>

                  <div className="editor-actions">
                    <button type="submit" disabled={saving}>
                      {saving ? t('admin.saving') : t('admin.save')}
                    </button>
                    {savedTick && <span className="saved-tick">✓ {t('admin.saved')}</span>}
                    {selected.id !== meId && (
                      <button type="button" className="btn-danger" onClick={deleteUser}>
                        {t('admin.deleteAccount')}
                      </button>
                    )}
                  </div>
                </form>

                {!selected.administrator && (
                  <>
                    <h3 className="sub-heading">{t('admin.userDevices')}</h3>
                    <div className="form-row assign-row">
                      <select
                        value={assignPick}
                        onChange={(e) => setAssignPick(e.target.value)}
                      >
                        <option value="">{t('admin.assignDevice')}</option>
                        {assignable.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.uniqueId})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!assignPick}
                        onClick={() => {
                          if (assignPick) assignDevice(selected.id, Number(assignPick));
                          setAssignPick('');
                        }}
                      >
                        {t('admin.assign')}
                      </button>
                    </div>

                    {userDevices.length === 0 ? (
                      <p className="muted">{t('admin.noUserDevices')}</p>
                    ) : (
                      <ul className="list">
                        {userDevices.map((d) => (
                          <li key={d.id} className="device-row">
                            <DeviceInfo d={d} />
                            <button
                              type="button"
                              className="btn-danger btn-small"
                              onClick={() => removeDevice(selected.id, d.id)}
                            >
                              {t('admin.remove')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {tab === 'gps' && (
        <div className="admin-grid">
          <section className="panel">
            <div className="panel-title-row">
              <h2>{t('admin.devices')}</h2>
              <button
                type="button"
                className="btn-small"
                onClick={() => setShowBulk((v) => !v)}
              >
                {showBulk ? '×' : t('admin.bulk.toggle')}
              </button>
            </div>

            {showBulk ? (
              <form className="form" onSubmit={bulkAdd}>
                <p className="muted">{t('admin.bulk.hint')}</p>
                <textarea
                  className="bulk-box"
                  rows={6}
                  value={bulkText}
                  onChange={(e) => {
                    setBulkText(e.target.value);
                    setBulkResults([]);
                  }}
                  placeholder={
                    'Van 12, 861157040411486, truck, +9647701234567, MV730\nVan 13, 861157040411487, MV710G'
                  }
                />
                {bulkRows.length > 0 && (
                  <ul className="bulk-preview">
                    {bulkRows.map((r) => (
                      <li
                        key={r.line}
                        className={
                          r.issue?.level === 'error'
                            ? 'row-err'
                            : r.issue
                              ? 'row-warn'
                              : 'row-ok'
                        }
                      >
                        {r.issue?.level === 'error' ? '✗' : r.issue ? '⚠' : '✓'}{' '}
                        {t('admin.bulk.line').replace('{n}', String(r.line))} {r.name}
                        {r.uniqueId ? ` · ${r.uniqueId}` : ''}
                        {r.model ? ` · ${r.model}` : ''}
                        {r.issue ? ` — ${t(r.issue.key)}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="form-row">
                  <select value={bulkOwner} onChange={(e) => setBulkOwner(e.target.value)}>
                    <option value="">{t('admin.bulk.assignAll')}</option>
                    {nonAdminUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name || u.email}
                      </option>
                    ))}
                  </select>
                  <button type="submit" disabled={bulkBusy || bulkReady.length === 0}>
                    {bulkBusy
                      ? t('admin.adding')
                      : t('admin.bulk.add').replace('{n}', String(bulkReady.length))}
                  </button>
                </div>
                {bulkResults.length > 0 && (
                  <ul className="bulk-preview">
                    {bulkResults.map((r, i) => (
                      <li key={i} className={r.ok ? 'row-ok' : 'row-err'}>
                        {r.ok ? '✓' : '✗'} {r.name} — {r.msgKey ? t(r.msgKey) : r.msg}
                      </li>
                    ))}
                  </ul>
                )}
              </form>
            ) : (
              <form className="form" onSubmit={addGps}>
                <div className="form-row">
                  <input
                    placeholder={t('admin.deviceName')}
                    value={dName}
                    onChange={(e) => setDName(e.target.value)}
                    required
                  />
                  <input
                    placeholder={t('admin.imei')}
                    value={dImei}
                    onChange={(e) => setDImei(e.target.value)}
                    required
                  />
                </div>
                {dIdIssue && (
                  <p className={dIdIssue.level === 'error' ? 'err-text' : 'warn-text'}>
                    {t(dIdIssue.key)}
                  </p>
                )}
                <div className="form-row">
                  <input
                    placeholder={t('admin.simPhone')}
                    value={dPhone}
                    onChange={(e) => setDPhone(e.target.value)}
                  />
                  <select value={dCategory} onChange={(e) => setDCategory(e.target.value)}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select value={dModel} onChange={(e) => setDModel(e.target.value)}>
                    <option value="">{t('admin.modelOpt')}</option>
                    {TRACKER_PRESETS.map((p) => (
                      <option key={p.model} value={p.model}>
                        {p.model}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <select value={dOwner} onChange={(e) => setDOwner(e.target.value)}>
                    <option value="">{t('admin.assignToCompany')}</option>
                    {nonAdminUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name || u.email}
                      </option>
                    ))}
                  </select>
                  <button type="submit" disabled={dBusy || dIdIssue?.level === 'error'}>
                    {dBusy ? t('admin.adding') : t('admin.addGps')}
                  </button>
                </div>
              </form>
            )}

            <div className="form-row filter-row">
              <input
                className="search"
                placeholder={t('admin.gps.search')}
                value={gpsQuery}
                onChange={(e) => setGpsQuery(e.target.value)}
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={unassignedOnly}
                  onChange={(e) => setUnassignedOnly(e.target.checked)}
                />
                <span>{t('admin.gps.unassignedOnly')}</span>
              </label>
            </div>
            <p className="muted count-line">
              {t('admin.gps.count')
                .replace('{n}', String(visibleDevices.length))
                .replace('{m}', String(devices.length))}
            </p>

            {devices.length === 0 ? (
              <p className="muted">{t('admin.noDevices')}</p>
            ) : visibleDevices.length === 0 ? (
              <p className="muted">{t('admin.gps.noMatch')}</p>
            ) : (
              <ul className="list">
                {visibleDevices.map((d) => (
                  <li key={d.id} className="device-row">
                    <DeviceInfo d={d} />
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn-ghost btn-small"
                        onClick={() => setCapsFor(capsFor === d.id ? null : d.id)}
                      >
                        {t('admin.caps.setup')}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-small"
                        onClick={() => {
                          setSmsFor(smsFor === d.id ? null : d.id);
                          // Open with the device's own model preselected.
                          const p = presetFor(d.model);
                          if (p) setSmsModel(p.model);
                        }}
                      >
                        {t('admin.sms.setup')}
                      </button>
                      <select
                        value={deviceOwner[d.id] ?? ''}
                        onChange={(e) => {
                          const uid = Number(e.target.value);
                          if (uid) assignDevice(uid, d.id);
                          else if (deviceOwner[d.id]) removeDevice(deviceOwner[d.id], d.id);
                        }}
                      >
                        <option value="">{t('admin.unassigned')}</option>
                        {nonAdminUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name || u.email}
                          </option>
                        ))}
                      </select>
                    </div>
                    {capsFor === d.id && <CapsCard d={d} />}
                    {smsFor === d.id && <SmsCard d={d} />}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
