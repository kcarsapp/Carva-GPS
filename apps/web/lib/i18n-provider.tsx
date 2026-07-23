'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALES,
  translate,
  type Locale,
} from './i18n';

interface I18nCtx {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: (key: string) => string;
  setLocale: (locale: Locale) => void;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({
  initialLocale = DEFAULT_LOCALE,
  children,
}: {
  initialLocale?: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    // Persist for the next page load (server reads this to set <html lang dir>).
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    // Update the live document so direction/lang flip immediately.
    document.documentElement.lang = next;
    document.documentElement.dir = LOCALES[next].dir;
    setLocaleState(next);
  }, []);

  const value = useMemo<I18nCtx>(
    () => ({
      locale,
      dir: LOCALES[locale].dir,
      t: (key: string) => translate(locale, key),
      setLocale,
    }),
    [locale, setLocale],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n must be used within <I18nProvider>');
  return ctx;
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <select
      className={className ?? 'lang-select'}
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      aria-label={t('common.lang')}
    >
      {(Object.keys(LOCALES) as Locale[]).map((code) => (
        <option key={code} value={code}>
          {LOCALES[code].label}
        </option>
      ))}
    </select>
  );
}
