import { useId } from "react";
import { clamp } from "@/lib/utils";

/** Animated circular progress gauge for a 0–100 percentage value. */
export function MetricRing({
  value,
  size = 132,
  stroke = 11,
  from = "var(--color-primary)",
  to = "var(--color-accent)",
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  from?: string;
  to?: string;
  label?: string;
}) {
  const rawId = useId().replace(/:/g, "");
  const gradId = `ring-${rawId}`;
  const pct = clamp(value, 0, 100);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-card-2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.7s cubic-bezier(0.4, 0, 0.2, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tabular-nums text-foreground">
          {Math.round(pct)}
          <span className="text-base text-muted">%</span>
        </span>
        {label && (
          <span className="mt-0.5 text-xs font-medium uppercase tracking-wider text-muted">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}
