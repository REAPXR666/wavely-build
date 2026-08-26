import type { ThreatEntry } from "@/types/shield";

type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger";

/** Map a threat severity to a Badge tone. */
export function severityTone(severity: string): BadgeTone {
  switch (severity) {
    case "critical":
      return "danger";
    case "high":
      return "danger";
    case "medium":
      return "warning";
    case "low":
      return "neutral";
    default:
      return "neutral";
  }
}

/** Map a remediation action to a Badge tone. */
export function actionTone(action: string): BadgeTone {
  switch (action) {
    case "quarantined":
      return "primary";
    case "removed":
      return "success";
    case "detected":
      return "warning";
    case "allowed":
      return "neutral";
    default:
      return "neutral";
  }
}

/** Order used when summarising the most severe finding in a set. */
const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function highestSeverity(threats: ThreatEntry[]): string | null {
  if (threats.length === 0) return null;
  return threats.reduce((acc, t) => {
    const rank = SEVERITY_RANK[t.severity] ?? 0;
    return rank > (SEVERITY_RANK[acc] ?? 0) ? t.severity : acc;
  }, threats[0].severity);
}

/** Compact relative time, e.g. "just now", "3m ago", "2h ago". */
export function relativeTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ms).toLocaleDateString();
}

/** Absolute timestamp for tooltips. */
export function absoluteTime(ms: number | null | undefined): string {
  if (!ms) return "Never";
  return new Date(ms).toLocaleString();
}

/** Shorten a long path for table display, preserving the file name. */
export function shortenPath(path: string, max = 52): string {
  if (path.length <= max) return path;
  const parts = path.split(/[\\/]/);
  const name = parts[parts.length - 1] ?? path;
  const head = path.slice(0, Math.max(0, max - name.length - 4));
  return `${head}…\\${name}`;
}
