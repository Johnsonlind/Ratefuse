// ==========================================
// 主题切换组件
// ==========================================
import { Sun, Moon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const timerRef = useRef<number | null>(null);

  const beijingNow = () => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
    const y = get('year');
    const m = get('month');
    const d = get('day');
    const hh = get('hour');
    const mm = get('minute');
    const ss = get('second');
    return new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  };

  const BJ = useMemo(() => ({ lat: 39.9042, lon: 116.4074 }), []);

  const getSunriseSunset = (dateUtcAsBjLocal: Date) => {
    const toRad = (v: number) => (v * Math.PI) / 180;

    const y = dateUtcAsBjLocal.getUTCFullYear();
    const m = dateUtcAsBjLocal.getUTCMonth() + 1;
    const d = dateUtcAsBjLocal.getUTCDate();

    const a = Math.floor((14 - m) / 12);
    const y2 = y + 4800 - a;
    const m2 = m + 12 * a - 3;
    const JDN =
      d +
      Math.floor((153 * m2 + 2) / 5) +
      365 * y2 +
      Math.floor(y2 / 4) -
      Math.floor(y2 / 100) +
      Math.floor(y2 / 400) -
      32045;
    const JD = JDN - 0.5;
    const n = JD - 2451545.0 + 0.0008;
    const Jstar = n - BJ.lon / 360;
    const M = (357.5291 + 0.98560028 * Jstar) % 360;
    const C =
      1.9148 * Math.sin(toRad(M)) +
      0.02 * Math.sin(toRad(2 * M)) +
      0.0003 * Math.sin(toRad(3 * M));
    const lambda = (M + C + 180 + 102.9372) % 360;
    const Jtransit =
      2451545.0 +
      Jstar +
      0.0053 * Math.sin(toRad(M)) -
      0.0069 * Math.sin(toRad(2 * lambda));
    const delta = Math.asin(Math.sin(toRad(lambda)) * Math.sin(toRad(23.44)));
    const cosOmega =
      (Math.sin(toRad(-0.833)) - Math.sin(toRad(BJ.lat)) * Math.sin(delta)) /
      (Math.cos(toRad(BJ.lat)) * Math.cos(delta));

    if (cosOmega <= -1) {
      return { sunrise: null as Date | null, sunset: null as Date | null };
    }
    if (cosOmega >= 1) {
      return { sunrise: null as Date | null, sunset: null as Date | null };
    }

    const omega = Math.acos(cosOmega);
    const Jrise = Jtransit - omega / (2 * Math.PI);
    const Jset = Jtransit + omega / (2 * Math.PI);

    const jdToDateUtc = (jd: number) => {
      const ms = (jd - 2440587.5) * 86400000;
      return new Date(ms);
    };

    const riseUtc = jdToDateUtc(Jrise);
    const setUtc = jdToDateUtc(Jset);

    const shiftToBjLocal = (utcDate: Date) => {
      return new Date(utcDate.getTime() + 8 * 60 * 60 * 1000);
    };

    return {
      sunrise: shiftToBjLocal(riseUtc),
      sunset: shiftToBjLocal(setUtc),
    };
  };

  const applyTheme = (next: 'light' | 'dark') => {
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    if (next === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  };

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleNextAutoSwitch = () => {
    clearTimer();
    const nowBj = beijingNow();
    const { sunrise, sunset } = getSunriseSunset(nowBj);
    if (!sunrise || !sunset) return;

    const now = nowBj.getTime();
    const rise = sunrise.getTime();
    const set = sunset.getTime();

    let nextTs: number | null = null;
    if (now < rise) nextTs = rise;
    else if (now < set) nextTs = set;
    else {
      const tomorrow = new Date(Date.UTC(nowBj.getUTCFullYear(), nowBj.getUTCMonth(), nowBj.getUTCDate() + 1, 0, 0, 0));
      const t = getSunriseSunset(tomorrow);
      nextTs = t.sunrise ? t.sunrise.getTime() : null;
    }
    if (!nextTs) return;
    const delay = Math.max(1000, Math.min(24 * 60 * 60 * 1000, nextTs - now + 250));
    timerRef.current = window.setTimeout(() => {
      if (localStorage.getItem('theme_preference') !== 'auto') return;
      const now2 = beijingNow();
      const s2 = getSunriseSunset(now2);
      if (s2.sunrise && s2.sunset) {
        const next = now2.getTime() >= s2.sunrise.getTime() && now2.getTime() < s2.sunset.getTime() ? 'light' : 'dark';
        applyTheme(next);
      }
      scheduleNextAutoSwitch();
    }, delay);
  };

  useEffect(() => {
    const savedPref = (localStorage.getItem('theme_preference') as 'auto' | 'light' | 'dark') || 'auto';

    if (savedPref === 'light' || savedPref === 'dark') {
      localStorage.setItem('theme', savedPref);
      applyTheme(savedPref);
      return;
    }

    const nowBj = beijingNow();
    const { sunrise, sunset } = getSunriseSunset(nowBj);
    const next =
      sunrise && sunset && nowBj.getTime() >= sunrise.getTime() && nowBj.getTime() < sunset.getTime()
        ? 'light'
        : 'dark';
    localStorage.setItem('theme', next);
    applyTheme(next);
    scheduleNextAutoSwitch();
    return () => clearTimer();
  }, []);

  const toggleTheme = () => {
    clearTimer();
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme_preference', nextTheme);
    localStorage.setItem('theme', nextTheme);
    applyTheme(nextTheme);
  };

  return (
    <button
      onClick={toggleTheme}
      className="fixed bottom-2 left-2 z-30 p-2 rounded-full glass-button"
      aria-label="切换主题"
    >
      {theme === 'light' ? (
        <Moon className="w-4 h-4 text-gray-800 dark:text-white" />
      ) : (
        <Sun className="w-4 h-4 text-gray-800 dark:text-white" />
      )}
    </button>
  );
} 
