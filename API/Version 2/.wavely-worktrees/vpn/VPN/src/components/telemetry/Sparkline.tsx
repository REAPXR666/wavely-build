import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

/**
 * Compact filled line chart for a single live metric series.
 * `domain` defaults to auto; pass [0, 100] for percentage metrics.
 */
export function Sparkline({
  data,
  color = "var(--color-primary)",
  height = 44,
  domain,
}: {
  data: number[];
  color?: string;
  height?: number;
  domain?: [number, number];
}) {
  const rawId = useId().replace(/:/g, "");
  const gradId = `spark-${rawId}`;
  const chartData = data.map((v, i) => ({ i, v }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 3, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={domain ?? ["auto", "auto"]} />
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          isAnimationActive={false}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
