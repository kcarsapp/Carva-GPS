'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { knotsToKmh, type TraccarDevice, type TraccarPosition } from '@carva/shared';
import './dashboard.css';

interface AuthUser {
  name: string;
  email: string;
  administrator: boolean;
}

// Free OSM raster style — street-level detail without an API key.
const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

interface Row {
  device: TraccarDevice;
  position?: TraccarPosition;
}

export default function Dashboard() {
  const router = useRouter();
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Record<number, maplibregl.Marker>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [followedOnce, setFollowedOnce] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  // Load the signed-in user (middleware guarantees a session, but fetch the
  // details for display; bounce to /login if the session turns out invalid).
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/session')
      .then((res) => {
        if (res.status === 401) {
          router.replace('/login');
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((u) => {
        if (alive && u)
          setUser({ name: u.name, email: u.email, administrator: u.administrator });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [router]);

  async function signOut() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
    }
  }

  // Init map once.
  useEffect(() => {
    if (map.current || !mapEl.current) return;
    map.current = new maplibregl.Map({
      container: mapEl.current,
      style: MAP_STYLE,
      center: [55.29, 25.22], // Dubai
      zoom: 12,
      attributionControl: { compact: true },
    });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Poll devices + positions.
  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const [dRes, pRes] = await Promise.all([
          fetch('/api/traccar/devices'),
          fetch('/api/traccar/positions'),
        ]);
        if (dRes.status === 401 || pRes.status === 401) {
          router.replace('/login');
          return;
        }
        if (!dRes.ok || !pRes.ok) throw new Error(`HTTP ${dRes.status}/${pRes.status}`);
        const devices: TraccarDevice[] = await dRes.json();
        const positions: TraccarPosition[] = await pRes.json();
        if (!alive) return;
        const posByDevice = new Map(positions.map((p) => [p.deviceId, p]));
        const next: Row[] = devices.map((d) => ({ device: d, position: posByDevice.get(d.id) }));
        setRows(next);
        setError(null);
        updateMarkers(next);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    }
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateMarkers(next: Row[]) {
    if (!map.current) return;
    for (const { device, position } of next) {
      if (!position) continue;
      const lngLat: [number, number] = [position.longitude, position.latitude];
      let marker = markers.current[device.id];
      if (!marker) {
        const el = document.createElement('div');
        el.className = 'carva-marker';
        el.innerHTML = '<div class="arrow">▲</div>';
        el.onclick = () => focus(device.id, lngLat);
        marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map' })
          .setLngLat(lngLat)
          .addTo(map.current);
        markers.current[device.id] = marker;
      } else {
        marker.setLngLat(lngLat);
      }
      marker.setRotation(position.course ?? 0);
      const el = marker.getElement();
      el.classList.toggle('online', device.status === 'online');

      if (!followedOnce) {
        map.current.easeTo({ center: lngLat, zoom: 14 });
        setFollowedOnce(true);
        setSelected(device.id);
      }
    }
  }

  function focus(deviceId: number, lngLat: [number, number]) {
    setSelected(deviceId);
    map.current?.easeTo({ center: lngLat, zoom: 15 });
  }

  return (
    <div className="dash">
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">
            <span className="dot" /> Carva GPS
          </div>
          <span className="live">{error ? '⚠ offline' : '● live'}</span>
        </div>

        <div className="userbar">
          <span className="who" title={user?.email}>
            {user ? user.name : 'Signed in'}
          </span>
          <div className="userbar-actions">
            {user?.administrator && (
              <a className="adminlink" href="/app/admin">Admin</a>
            )}
            <button className="signout" onClick={signOut}>Sign out</button>
          </div>
        </div>

        {error && <div className="err">Can’t reach tracker server: {error}</div>}

        {rows.length === 0 && !error && <div className="empty">Waiting for devices…</div>}

        <ul className="devices">
          {rows.map(({ device, position }) => (
            <li
              key={device.id}
              className={`device ${selected === device.id ? 'sel' : ''}`}
              onClick={() =>
                position && focus(device.id, [position.longitude, position.latitude])
              }
            >
              <div className="row1">
                <span className={`stat ${device.status}`} />
                <span className="name">{device.name}</span>
                <span className="spd">
                  {position ? `${knotsToKmh(position.speed)} km/h` : '—'}
                </span>
              </div>
              <div className="row2">
                {position
                  ? `${position.latitude.toFixed(4)}, ${position.longitude.toFixed(4)} · hdg ${Math.round(
                      position.course,
                    )}°`
                  : 'no fix yet'}
              </div>
            </li>
          ))}
        </ul>

        <div className="hint">
          Run the simulator to see a car move:
          <code>node tools/simulator/simulate.mjs</code>
        </div>
      </aside>

      <div className="map" ref={mapEl} />
    </div>
  );
}
