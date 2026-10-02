/**
 * The default closing line of the showcase panels when the admin wrote none: the year, the product name and the
 * platform's default country ("2026 Acme / India"). The year is passed in so tests do not depend on the clock.
 */
export function defaultFooter(
  name: string,
  countryIso: string | null | undefined,
  locale: string,
  year: number = new Date().getFullYear(),
): string {
  const head = `${year} ${name}`;
  const iso = countryIso?.trim().toUpperCase();
  if (!iso || !/^[A-Z]{2}$/.test(iso)) return head;
  try {
    const country = new Intl.DisplayNames([locale], { type: 'region' }).of(iso);
    return country && country !== iso ? `${head} / ${country}` : head;
  } catch {
    return head;
  }
}
