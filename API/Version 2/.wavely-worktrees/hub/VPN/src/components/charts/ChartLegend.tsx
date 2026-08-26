import { cn } from "@/lib/utils";

export interface LegendItem {
  label: string;
  color: string;
  /** Optional formatted value shown to the right. */
  value?: string;
}

/** Compact, reusable legend that pairs with the chart primitives. */
export function ChartLegend({
  items,
  className,
}: {
  items: LegendItem[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1.5", className)}>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2 text-xs">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: it.color }}
          />
          <span className="text-muted">{it.label}</span>
          {it.value && (
            <span className="font-medium tabular-nums text-foreground">
              {it.value}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
