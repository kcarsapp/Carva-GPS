'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowRight, Loader2, Lock, Mail, Navigation, Radio, ShieldCheck } from 'lucide-react';

import { CarvaWordmark } from '@/components/dashboard/carva-logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n, LanguageSwitcher } from '@/lib/i18n-provider';
import { ThemeToggle } from '@/lib/theme-provider';

/* Sign-in, on the fleet design system (black & gold, app/fleet.css) instead
   of its old standalone blue stylesheet - the first screen a customer sees
   now looks like the product behind it. Behaviour is unchanged: same fields,
   same /api/auth/login call, same error mapping, same redirect. */

/** Decorative: a stylised night map with one gold route, drawn in SVG. */
function RouteArt() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 600 600"
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <radialGradient id="glow" cx="70%" cy="30%" r="70%">
          <stop offset="0%" stopColor="hsl(41 52% 62%)" stopOpacity="0.16" />
          <stop offset="60%" stopColor="hsl(41 52% 62%)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="route" x1="0" x2="1" y1="1" y2="0">
          <stop offset="0%" stopColor="hsl(41 52% 62%)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="hsl(44 70% 76%)" />
        </linearGradient>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="white" strokeOpacity="0.045" />
        </pattern>
      </defs>
      <rect width="600" height="600" fill="url(#grid)" />
      <rect width="600" height="600" fill="url(#glow)" />
      {/* streets */}
      <g stroke="white" strokeOpacity="0.07" strokeWidth="6" fill="none" strokeLinecap="round">
        <path d="M-20 420 C 120 380, 180 300, 300 290 S 520 200, 640 120" />
        <path d="M80 -20 C 110 140, 160 260, 140 420 S 180 560, 220 640" />
        <path d="M360 -20 C 340 120, 380 240, 460 330 S 560 480, 640 520" />
      </g>
      {/* the route */}
      <path
        d="M90 520 C 150 470, 150 400, 210 360 S 330 330, 360 280 S 430 170, 500 140"
        fill="none"
        stroke="url(#route)"
        strokeWidth="4"
        strokeLinecap="round"
        className="login-route"
      />
      <circle cx="90" cy="520" r="6" fill="hsl(41 52% 62%)" fillOpacity="0.5" />
      <g transform="translate(500 140)">
        <circle r="18" fill="hsl(41 52% 62%)" fillOpacity="0.15" className="login-pulse" />
        <circle r="8" fill="#12100e" stroke="hsl(41 56% 66%)" strokeWidth="3" />
      </g>
    </svg>
  );
}

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
    <div className="app-fleet grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel - desktop only; phones go straight to the form. */}
      <aside className="relative hidden overflow-hidden bg-[#0b0a09] text-[#f4efe6] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <RouteArt />
        {/* Lets the art recede behind the copy so no line crosses the text. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-r from-[#0b0a09] via-[#0b0a09]/80 to-transparent rtl:bg-gradient-to-l"
        />
        <div className="relative">
          <CarvaWordmark className="h-11 [&_img]:!brightness-100 [&_img]:!opacity-100" />
        </div>
        <div className="relative max-w-md">
          <p className="eyebrow !text-[hsl(41_52%_62%)]">{t('login.brand.eyebrow')}</p>
          <h2 className="font-display mt-3 text-[34px] font-semibold leading-[1.15] tracking-tight">
            {t('login.brand.title')}
          </h2>
          <ul className="stagger mt-8 space-y-3.5 text-sm text-[#f4efe6]/75">
            {(
              [
                [Radio, 'login.brand.live'],
                [Navigation, 'login.brand.follow'],
                [ShieldCheck, 'login.brand.control'],
              ] as const
            ).map(([Icon, key]) => (
              <li key={key} className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-[hsl(41_56%_66%)]">
                  <Icon className="h-4 w-4" />
                </span>
                {t(key)}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-[#f4efe6]/40">© Carva</p>
      </aside>

      {/* Form */}
      <main className="relative flex flex-col bg-background px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between gap-3">
          <a href="/" className="lg:invisible" aria-label="Carva">
            <CarvaWordmark className="h-9" />
          </a>
          <div className="flex items-center gap-2">
            <LanguageSwitcher className="h-9 rounded-lg border bg-card px-2.5 text-sm text-foreground outline-none focus:border-primary" />
            <ThemeToggle className="press flex h-9 w-9 items-center justify-center rounded-lg border bg-card text-muted-foreground hover:text-foreground" />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <form onSubmit={onSubmit} className="rise w-full max-w-[380px]" noValidate={false}>
            <h1 className="font-display text-[28px] font-semibold tracking-tight">
              {t('login.title')}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{t('login.lead')}</p>

            {error && (
              <div
                role="alert"
                className="rise mt-6 flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/[0.07] px-3.5 py-3 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-7 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">{t('login.email')}</span>
                <span className="relative block">
                  <Mail className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="h-11 ps-9 text-[15px]"
                  />
                </span>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">{t('login.password')}</span>
                <span className="relative block">
                  <Lock className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="h-11 ps-9 text-[15px]"
                  />
                </span>
              </label>
            </div>

            <Button type="submit" disabled={busy} className="mt-6 h-11 w-full text-[15px]">
              {busy ? (
                <>
                  <Loader2 className="animate-spin" />
                  {t('login.submitting')}
                </>
              ) : (
                <>
                  {t('login.submitPlain')}
                  <ArrowRight className="rtl:rotate-180" />
                </>
              )}
            </Button>

            <div className="mt-6 flex items-center justify-between text-sm">
              <a href="/signup" className="text-muted-foreground transition-colors hover:text-foreground">
                {t('login.noAccount')}
              </a>
              <a href="/" className="text-muted-foreground transition-colors hover:text-foreground">
                {t('login.home')}
              </a>
            </div>
          </form>
        </div>
      </main>
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
