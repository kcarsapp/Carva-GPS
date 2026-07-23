'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n, LanguageSwitcher } from '@/lib/i18n-provider';
import './login.css';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { t } = useI18n();
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
      if (res.status === 401) setError(t('login.err.creds'));
      else if (res.status === 502) setError(t('login.err.server'));
      else setError(t('login.err.generic'));
    } catch {
      setError(t('login.err.network'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-top">
          <a className="brand" href="/">
            <span className="dot" /> Carva GPS
          </a>
          <LanguageSwitcher className="lang-select" />
        </div>
        <h1>{t('login.title')}</h1>
        <p className="lead">{t('login.lead')}</p>

        {error && <div className="err">{error}</div>}

        <label>
          {t('login.email')}
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
          {t('login.password')}
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
          {busy ? t('login.submitting') : t('login.submit')}
        </button>

        <a className="back" href="/signup">No account yet? Sign up</a>
        <a className="back" href="/">{t('login.back')}</a>
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
