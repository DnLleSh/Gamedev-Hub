/** Human-friendly relative time: "5 мин назад", "вчера", "12 мар". */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = (Date.now() - then) / 1000;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  if (diff < 172800) return "вчера";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

/** "34 с" / "2 мин 05 с" — build durations. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} с`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} мин ${String(s).padStart(2, "0")} с`;
}
