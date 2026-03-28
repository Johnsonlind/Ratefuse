// ==========================================
// 时间格式化工具
// ==========================================
const TZ_CHINA = 'Asia/Shanghai' as const;

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
