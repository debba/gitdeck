import type { Language } from "./i18n";

const RELATIVE_TIME_LABELS: Record<Language, {
  now: string;
  minute: (value: number) => string;
  hour: (value: number) => string;
  day: (value: number) => string;
  month: (value: number) => string;
  year: (value: number) => string;
}> = {
  en: {
    now: "just now",
    minute: (value) => `${value}m ago`,
    hour: (value) => `${value}h ago`,
    day: (value) => `${value}d ago`,
    month: (value) => `${value}mo ago`,
    year: (value) => `${value}y ago`,
  },
  it: {
    now: "ora",
    minute: (value) => `${value} min fa`,
    hour: (value) => `${value} h fa`,
    day: (value) => `${value} g fa`,
    month: (value) => `${value} mesi fa`,
    year: (value) => `${value} anni fa`,
  },
  fr: {
    now: "à l'instant",
    minute: (value) => `il y a ${value} min`,
    hour: (value) => `il y a ${value} h`,
    day: (value) => `il y a ${value} j`,
    month: (value) => `il y a ${value} mois`,
    year: (value) => `il y a ${value} ans`,
  },
  es: {
    now: "ahora",
    minute: (value) => `hace ${value} min`,
    hour: (value) => `hace ${value} h`,
    day: (value) => `hace ${value} d`,
    month: (value) => `hace ${value} meses`,
    year: (value) => `hace ${value} años`,
  },
  de: {
    now: "gerade eben",
    minute: (value) => `vor ${value} Min.`,
    hour: (value) => `vor ${value} Std.`,
    day: (value) => `vor ${value} T`,
    month: (value) => `vor ${value} Mon.`,
    year: (value) => `vor ${value} J`,
  },
  zh: {
    now: "刚刚",
    minute: (value) => `${value} 分钟前`,
    hour: (value) => `${value} 小时前`,
    day: (value) => `${value} 天前`,
    month: (value) => `${value} 个月前`,
    year: (value) => `${value} 年前`,
  },
};

function currentLanguage(): Language {
  if (typeof document === "undefined") return "en";
  const language = document.documentElement.lang.split("-")[0] as Language;
  return language in RELATIVE_TIME_LABELS ? language : "en";
}

export function formatRelativeTime(iso: string, now = Date.now(), language: Language = currentLanguage()): string {
  if (!iso) return "";
  const date = new Date(iso);
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  const labels = RELATIVE_TIME_LABELS[language];
  if (minutes < 1) return labels.now;
  if (minutes < 60) return labels.minute(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return labels.hour(hours);
  const days = Math.floor(hours / 24);
  if (days < 30) return labels.day(days);
  const months = Math.floor(days / 30);
  if (months < 12) return labels.month(months);
  const years = Math.floor(months / 12);
  return labels.year(years);
}

export function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

export function formatExactNumber(value: number): string {
  return new Intl.NumberFormat(currentLanguage()).format(value);
}

export function formatReadableDate(iso: string, locale = currentLanguage()): string {
  if (!iso) return "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatBytes(value: number): string {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || Number.isInteger(size) ? 0 : 1)} ${units[unitIndex]}`;
}
