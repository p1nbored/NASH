import { getIntlLocale } from '@/i18n/i18n'

let cached: { locale: string; formatter: Intl.DateTimeFormat } | null = null

/** Medium date and short time in the UI locale; the exact ISO value stays on the `<time>` element. */
export function formatWorkbenchRequestTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  const locale = getIntlLocale()
  if (!cached || cached.locale !== locale) {
    cached = {
      locale,
      formatter: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
    }
  }
  return cached.formatter.format(date)
}
