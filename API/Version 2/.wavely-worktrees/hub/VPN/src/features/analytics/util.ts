import type { ThreatEntry } from "@/types/shield";

export type Severity = "critical" | "high" | "medium" | "low";

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

/** Brand-aligned color for each severity (uses design tokens). */
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "var(--color-danger)",
  high: "var(--color-warning)",
  medium: "var(--color-accent)",
  low: "var(--color-primary)",
};

export const SEVERITY_TONE: Record<
  Severity,
  "danger" | "warning" | "primary" | "neutral"
> = {
  critical: "danger",
  high: "warning",
  medium: "primary",
  low: "neutral",
};

export function normalizeSeverity(s: string): Severity {
  const v = s.toLowerCase();
  if (v === "critical" || v === "high" || v === "medium" || v === "low") {
    return v;
  }
  return "low";
}

/** Count threats per severity. */
export function severityCounts(threats: ThreatEntry[]): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const t of threats) counts[normalizeSeverity(t.severity)] += 1;
  return counts;
}

export interface DayBucket {
  /** Short label, e.g. "Jun 3". */
  day: string;
  /** Start-of-day timestamp (ms). */
  ts: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

/** Bucket detections into the last `days` calendar days (local time). */
export function detectionsByDay(
  threats: ThreatEntry[],
  days = 14,
  now = Date.now(),
): DayBucket[] {
  const buckets: DayBucket[] = [];
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    buckets.push({
      day: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      ts: d.getTime(),
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      total: 0,
    });
  }

  const firstTs = buckets[0]?.ts ?? 0;
  for (const t of threats) {
    if (t.detectedAt < firstTs) continue;
    const d = new Date(t.detectedAt);
    d.setHours(0, 0, 0, 0);
    const bucket = buckets.find((b) => b.ts === d.getTime());
    if (bucket) {
      const sev = normalizeSeverity(t.severity);
      bucket[sev] += 1;
      bucket.total += 1;
    }
  }
  return buckets;
}

/** Compact relative time, e.g. "3m ago", "2h ago", "5d ago". */
export function relativeTime(tsMs: number, now = Date.now()): string {
  const diff = Math.max(0, now - tsMs);
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(tsMs).toLocaleDateString();
}
