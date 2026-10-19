/**
 * Axis maths for the hand-built SVG charts. Kept pure so the numbers are tested rather
 * than eyeballed.
 */

/**
 * A clean axis top and its ticks: 0 and steps of 1, 2, 2.5 or 5 × 10ⁿ, so the gridlines
 * land on numbers people say out loud (0 · 50K · 100K), never 0 · 37K · 74K.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];

  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;

  const ticks: number[] = [];
  for (let value = 0; value < max + step / 2; value += step) {
    ticks.push(Number(value.toPrecision(12)));
    if (value >= max) break;
  }
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks.length * step).toPrecision(12)));
  return ticks;
}

/** 950 · 1.2K · 45K · 1.3M — short enough for an axis or a bar tip. Latin digits. */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const scaled = (n: number, suffix: string) => {
    const text = n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, '');
    return `${sign}${text}${suffix}`;
  };

  if (abs >= 1e9) return scaled(abs / 1e9, 'B');
  if (abs >= 1e6) return scaled(abs / 1e6, 'M');
  if (abs >= 1e3) return scaled(abs / 1e3, 'K');
  return `${sign}${Math.round(abs)}`;
}

/** Which x labels to print so they never crowd: every n-th, always the latest. */
export function labelEvery(count: number, maxLabels = 7): number {
  return Math.max(1, Math.ceil(count / maxLabels));
}

/** "14 أكتوبر" for an axis, from YYYY-MM-DD, without timezone surprises. */
export function shortDay(day: string): string {
  return new Intl.DateTimeFormat('ar-IQ-u-nu-latn', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`));
}
