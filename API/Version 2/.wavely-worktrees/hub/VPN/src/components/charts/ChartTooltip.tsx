interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

/**
 * Glassmorphism tooltip shared across every Wavely chart. Mirrors the look used
 * on the Dashboard so all visualizations feel like one product.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  format,
  labelFormat,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  format?: (v: number) => string;
  labelFormat?: (v: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card-2/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      {label != null && (
        <p className="mb-1 font-medium text-foreground">
          {labelFormat ? labelFormat(label) : label}
        </p>
      )}
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: p.color }}
          />
          <span className="text-muted">{p.name}</span>
          <span className="ml-3 font-medium tabular-nums text-foreground">
            {typeof p.value === "number" && format ? format(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}
