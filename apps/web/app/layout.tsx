import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, isLocale } from '@/lib/i18n';
import { I18nProvider } from '@/lib/i18n-provider';
import './globals.css';
// Tailwind/Shadcn theme for the Fleet sections. Scoped under `.app-fleet`
// (see fleet.css) and preflight-disabled, so it doesn't affect existing pages.
import './fleet.css';

export const metadata: Metadata = {
  title: 'Carva GPS — Track anything, anywhere',
  description:
    'Modern GPS tracking for personal use, car rental, school bus, and logistics. Connect any GPS tracker. Web, iOS, and Android.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieLocale = cookies().get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const dir = LOCALES[locale].dir;

  return (
    <html lang={locale} dir={dir}>
      <body>
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
