import { translations, type TranslationKey } from "../i18n/translations";

export type Language = keyof typeof translations;

export const DEFAULT_LANGUAGE: Language = "en";
export const LANGUAGE_STORAGE_KEY = "gh-dash.language";
export const SUPPORTED_LANGUAGES = Object.keys(translations) as Language[];

type Replacements = Record<string, string | number>;

export function isSupportedLanguage(value: string | null | undefined): value is Language {
  return Boolean(value && SUPPORTED_LANGUAGES.includes(value as Language));
}

export function normalizeLanguage(value: string | null | undefined): Language | null {
  if (!value) return null;
  const normalized = value.toLowerCase().split("-")[0];
  return isSupportedLanguage(normalized) ? normalized : null;
}

export function detectLanguage(languages: readonly string[] = []): Language {
  for (const language of languages) {
    const normalized = normalizeLanguage(language);
    if (normalized) return normalized;
  }
  return DEFAULT_LANGUAGE;
}

export function readPersistedLanguage(storage: Pick<Storage, "getItem"> | undefined): Language | null {
  try {
    return normalizeLanguage(storage?.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function persistLanguage(storage: Pick<Storage, "setItem"> | undefined, language: Language): void {
  try {
    storage?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Storage can be unavailable in private browsing or tests.
  }
}

export function translate(language: Language, key: TranslationKey, replacements: Replacements = {}): string {
  const locale = translations[language] as Partial<Record<TranslationKey, string>>;
  const template = locale[key] ?? translations[DEFAULT_LANGUAGE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, token) => (
    Object.prototype.hasOwnProperty.call(replacements, token) ? String(replacements[token]) : match
  ));
}
