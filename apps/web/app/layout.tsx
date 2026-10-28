import type { Metadata } from 'next';
import { DM_Sans, Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, isLocale } from '@/lib/i18n';
import { I18nProvider } from '@/lib/i18n-provider';
import { THEME_COOKIE, type ThemePref } from '@/lib/theme';
import { ACCENT_COOKIE, isAccent } from '@/lib/accent';
import { ThemeProvider } from '@/lib/theme-provider';
import './globals.css';
// Tailwind/Shadcn theme for the Fleet sections. Scoped under `.app-fleet`
// (see fleet.css) and preflight-disabled, so it doesn't affect existing pages.
import './fleet.css';

// Self-hosted at build time by next/font: no request to Google from the
// browser, no layout shift (size-adjusted fallbacks). Exposed as CSS
// variables; fleet.css applies them to English only, so Arabic and Kurdish
// keep their own fonts from globals.css.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const display = DM_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Carva GPS — Track anything, anywhere',
  description:
    'Modern GPS tracking for personal use, car rental, school bus, and logistics. Connect any GPS tracker. Web, iOS, and Android.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieLocale = cookies().get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const dir = LOCALES[locale].dir;

  // Stamp the theme server-side so dark mode doesn't flash on load. "system"
  // can't be resolved here; the client provider corrects it after hydration.
  const cookieTheme = cookies().get(THEME_COOKIE)?.value;
  const theme: ThemePref =
    cookieTheme === 'dark' || cookieTheme === 'light' || cookieTheme === 'system'
      ? cookieTheme
      : 'system';

  // Interface accent (Settings), stamped server-side so there is no flash.
  const cookieAccent = cookies().get(ACCENT_COOKIE)?.value;
  const accent = isAccent(cookieAccent) ? cookieAccent : 'gold';

  return (
    <html lang={locale} dir={dir} data-accent={accent} className={theme === 'dark' ? 'dark' : undefined}>
      <body className={`${inter.variable} ${display.variable}`}>
        <I18nProvider initialLocale={locale}>
          <ThemeProvider initialTheme={theme}>{children}</ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
