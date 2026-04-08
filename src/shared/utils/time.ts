// ==========================================
// 时间格式化工具
// ==========================================
export const TZ_CHINA = 'Asia/Shanghai' as const;

function safeDate(value?: string | number | Date | null) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatChinaDateTime(value?: string | number | Date | null): string {
  const d = safeDate(value);
  if (!d) return value ? String(value) : '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TZ_CHINA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(d)
    .replace(/\//g, '-');
}

export function formatChinaDate(value?: string | number | Date | null): string {
  const d = safeDate(value);
  if (!d) return value ? String(value) : '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TZ_CHINA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(d)
    .replace(/\//g, '-');
}

export function calendarYearFromIsoDate(s?: string | null): number | undefined {
  if (!s) return undefined;
  const m = String(s).trim().match(/^(\d{4})/);
  if (!m) return undefined;
  const y = parseInt(m[1], 10);
  return Number.isFinite(y) ? y : undefined;
}

export function formatChinaYyyyMmDd(value?: string | number | Date | null): string {
  const d = safeDate(value ?? new Date());
  if (!d) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_CHINA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
