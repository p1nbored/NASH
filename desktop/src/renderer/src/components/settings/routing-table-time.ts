import { getIntlLocale } from '@/i18n/i18n'

/** A stored ISO time as a short local date and time; the raw value when it does not parse. */
export function formatRoutingTime(iso: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) {
    return iso
  }
  return new Intl.DateTimeFormat(getIntlLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(time)
}
