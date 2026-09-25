/**
 * The languages WhimWatch can be shown in. Adding one: a catalogue in ./catalogs/<id>.ts, an entry
 * here and in CATALOGS (./index.ts). See "Translating WhimWatch" in CONTRIBUTING.md.
 */
export const LOCALE_IDS = ['en', 'es', 'it'] as const;

export type LocaleId = (typeof LOCALE_IDS)[number];

/** The Language setting: a locale, or whatever the system prefers. */
export type LanguageSetting = 'system' | LocaleId;

export interface LocaleInfo {
  /** The language's name in itself, as the Language setting lists it ("Italiano"). */
  name: string;
  /** BCP 47 tag for dates, numbers, plurals and lists. */
  intl: string;
  /** A different tag for lists only, when the catalogue's style differs from the default for `intl`. */
  listIntl?: string;
  /**
   * Units said in words rather than counted ("yesterday", "last week"); all of them when unset. Only
   * where the words fit after "Released" and "Checked": Italian's "settimana scorsa" wants an article
   * there, so weeks and longer are counted ("1 settimana fa").
   */
  relativeWords?: readonly Intl.RelativeTimeFormatUnit[];
}

export const LOCALE_INFO: Record<LocaleId, LocaleInfo> = {
  // British list style: "wicked.cc, LoversLab and Patreon", without the serial comma, as the copy is written.
  en: { name: 'English', intl: 'en', listIntl: 'en-GB' },
  // "la semana pasada", "el mes pasado" carry their own article, so they read well after "Publicado".
  es: { name: 'Español', intl: 'es' },
  it: { name: 'Italiano', intl: 'it', relativeWords: ['second', 'minute', 'hour', 'day'] },
};

export const DEFAULT_LOCALE: LocaleId = 'en';

export function isLocaleId(value: unknown): value is LocaleId {
  return LOCALE_IDS.some((id) => id === value);
}

export function isLanguageSetting(value: unknown): value is LanguageSetting {
  return value === 'system' || isLocaleId(value);
}

/**
 * The first of the system's preferred languages that WhimWatch has, by language alone ("it-CH" is
 * Italian); English when none is. Preferences come in order, so an Italian speaker who also lists
 * German gets Italian while German isn't there.
 */
export function resolveLocale(preferred: readonly string[]): LocaleId {
  for (const tag of preferred) {
    const language = tag.toLowerCase().split(/[-_]/)[0];
    if (isLocaleId(language)) return language;
  }
  return DEFAULT_LOCALE;
}
