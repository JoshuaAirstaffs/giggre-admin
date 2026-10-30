/**
 * Countries a carousel slide can be limited to. Codes are ISO 3166-1 alpha-2,
 * matching CurrentUserProvider.countryCode in giggre_app. Only `enabled`
 * countries can be picked for now — the rest are listed as "coming soon".
 * To open a country up, flip its `enabled` to true.
 */
export interface CarouselCountry {
  code: string;
  name: string;
  flag: string;
  enabled: boolean;
}

export const CAROUSEL_COUNTRIES: readonly CarouselCountry[] = [
  { code: "PH", name: "Philippines", flag: "🇵🇭", enabled: true },
  { code: "US", name: "United States", flag: "🇺🇸", enabled: true },
  { code: "AE", name: "United Arab Emirates", flag: "🇦🇪", enabled: false },
  { code: "AU", name: "Australia", flag: "🇦🇺", enabled: false },
  { code: "CA", name: "Canada", flag: "🇨🇦", enabled: false },
  { code: "DE", name: "Germany", flag: "🇩🇪", enabled: false },
  { code: "FR", name: "France", flag: "🇫🇷", enabled: false },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧", enabled: false },
  { code: "HK", name: "Hong Kong", flag: "🇭🇰", enabled: false },
  { code: "ID", name: "Indonesia", flag: "🇮🇩", enabled: false },
  { code: "IN", name: "India", flag: "🇮🇳", enabled: false },
  { code: "JP", name: "Japan", flag: "🇯🇵", enabled: false },
  { code: "KR", name: "South Korea", flag: "🇰🇷", enabled: false },
  { code: "KW", name: "Kuwait", flag: "🇰🇼", enabled: false },
  { code: "MY", name: "Malaysia", flag: "🇲🇾", enabled: false },
  { code: "NZ", name: "New Zealand", flag: "🇳🇿", enabled: false },
  { code: "QA", name: "Qatar", flag: "🇶🇦", enabled: false },
  { code: "SA", name: "Saudi Arabia", flag: "🇸🇦", enabled: false },
  { code: "SG", name: "Singapore", flag: "🇸🇬", enabled: false },
  { code: "TH", name: "Thailand", flag: "🇹🇭", enabled: false },
  { code: "TW", name: "Taiwan", flag: "🇹🇼", enabled: false },
  { code: "VN", name: "Vietnam", flag: "🇻🇳", enabled: false },
];

export const ENABLED_CAROUSEL_COUNTRIES = CAROUSEL_COUNTRIES.filter((c) => c.enabled);

/** Every country a slide can currently be shown in — the default for new slides. */
export const ALL_CAROUSEL_COUNTRY_CODES: string[] = ENABLED_CAROUSEL_COUNTRIES.map((c) => c.code);

export function countryByCode(code: string): CarouselCountry | undefined {
  return CAROUSEL_COUNTRIES.find((c) => c.code === code);
}

/** A slide's countries; slides saved before the field existed show everywhere. */
export function slideCountries(item: unknown): string[] {
  const c = (item as { countries?: unknown })?.countries;
  return Array.isArray(c) ? c.filter((x): x is string => typeof x === "string") : ALL_CAROUSEL_COUNTRY_CODES;
}

/** True when a slide is shown in every country that's currently available. */
export function coversAllCountries(codes: string[]): boolean {
  return ALL_CAROUSEL_COUNTRY_CODES.every((c) => codes.includes(c));
}
