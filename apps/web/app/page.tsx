import type { AccountType } from '@carva/shared';

const accountTypes: { type: AccountType; ico: string; title: string; desc: string }[] = [
  { type: 'personal', ico: '🚗', title: 'Personal', desc: 'Track your own car, family, or a pet tag. Simple and private.' },
  { type: 'car_rental', ico: '🔑', title: 'Car Rental', desc: 'Manage your rental fleet, assign cars to renters, track mileage and contracts.' },
  { type: 'school_bus', ico: '🚌', title: 'School Bus', desc: 'Routes, students, and live parent view with pickup & drop-off alerts.' },
  { type: 'logistics', ico: '🚚', title: 'Logistics', desc: 'Fleet, drivers, dispatch, route optimization, and detailed reports.' },
];

const features = [
  { h: 'Connect any tracker', p: 'GT06, TK103, Coban, Teltonika, H02 and ~200 more protocols.' },
  { h: 'Live map', p: 'Real-time moving markers with speed, heading, and status.' },
  { h: 'Trip history & replay', p: 'Replay any journey, see stops, harsh braking, and idling.' },
  { h: 'Geofences & alerts', p: 'Get notified on enter/exit, overspeed, SOS, and ignition.' },
  { h: 'Multi-user', p: 'Owners, admins, drivers, and viewers with the right access.' },
  { h: 'Works everywhere', p: 'One account across web, iOS, and Android.' },
];

export default function Home() {
  return (
    <div className="container">
      <nav className="nav">
        <div className="brand">
          <span className="dot" /> Carva GPS
        </div>
        <div className="nav-links">
          <a href="#who">Who it's for</a>
          <a href="#features">Features</a>
          <a href="#trackers">Trackers</a>
        </div>
        <a className="btn btn-ghost" href="/app">Sign in</a>
      </nav>

      <header className="hero">
        <span className="eyebrow">Web · iOS · Android</span>
        <h1>
          Track anything,<br />
          <span>anywhere.</span>
        </h1>
        <p>
          One modern, easy-to-use app for personal tracking, car rental, school buses, and
          logistics fleets — connected to any GPS hardware you already have.
        </p>
        <div className="cta-row">
          <a className="btn btn-primary" href="/app">Open the app →</a>
          <a className="btn btn-ghost" href="#who">See who it's for</a>
        </div>
      </header>

      <section className="section" id="who">
        <h2>Built for how you track</h2>
        <p className="sub">Pick your account type — the app adapts to you.</p>
        <div className="grid">
          {accountTypes.map((a) => (
            <div className="card" key={a.type}>
              <div className="ico">{a.ico}</div>
              <h3>{a.title}</h3>
              <p>{a.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="features">
        <h2>Everything you need</h2>
        <p className="sub">Powerful tracking, made simple.</p>
        <div className="features">
          {features.map((f) => (
            <div className="feature" key={f.h}>
              <div className="tick">✓</div>
              <div>
                <h4>{f.h}</h4>
                <p>{f.p}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="trackers">
        <h2>Connect your hardware</h2>
        <p className="sub">
          Carva works with standard GPS trackers out of the box — including the affordable
          Chinese models most fleets already use.
        </p>
        <div className="grid">
          {['GT06 / Concox', 'TK103 / GPS103', 'Coban', 'Teltonika', 'H02', 'Sinotrack'].map((t) => (
            <div className="card" key={t}>
              <h3>{t}</h3>
              <p>Plug in the device IMEI and point it to your Carva server — done.</p>
            </div>
          ))}
        </div>
        <div className="note">
          Note: Apple AirTags use a closed network with no public API, so they can’t be
          officially integrated. Carva supports GPS and BLE trackers; AirTag support is
          exploratory only.
        </div>
      </section>

      <footer className="footer">
        <div>© {new Date().getFullYear()} Carva GPS</div>
        <div>Web · iOS · Android</div>
      </footer>
    </div>
  );
}
