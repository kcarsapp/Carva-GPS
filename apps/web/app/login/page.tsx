'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import './login.css';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/app';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.replace(next);
        return;
      }
      if (res.status === 401) setError('Wrong email or password.');
      else if (res.status === 502) setError('Can’t reach the tracker server. Try again.');
      else setError('Something went wrong. Try again.');
    } catch {
      setError('Network error. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <a className="brand" href="/">
          <span className="dot" /> Carva GPS
        </a>
        <h1>Sign in</h1>
        <p className="lead">Use your Traccar account to access the live map.</p>

        {error && <div className="err">{error}</div>}

        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </label>

        <button className="submit" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in →'}
        </button>

        <a className="back" href="/">← Back to home</a>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
