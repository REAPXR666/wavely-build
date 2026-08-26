import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "./ChartTooltip";

export interface AreaSeries {
  /** Key into each datum object. */
  key: string;
  /** Display name in tooltip. */
  name: string;
  /** CSS color (token var recommended). */
  color: string;
}

/**
 * Reusable multi-series area chart with gradient fills. Used for performance
 * and throughput trends. X axis is hidden by default (dense time series); pass
 * `xKey` + `xFormatter` to show labelled ticks.
 */
export function AreaTrendChart<T extends object>({
  data,
  series,
  xKey = "i",
  height = 220,
  yDomain,
  yWidth = 32,
  yFormatter,
  valueFormatter,
  xFormatter,
  showXAxis = false,
}: {
  data: T[];
  series: AreaSeries[];
  xKey?: string;
  height?: number;
  yDomain?: [number | string, number | string];
  yWidth?: number;
  yFormatter?: (v: number) => string;
  valueFormatter?: (v: number) => string;
  xFormatter?: (v: string | number) => string;
  showXAxis?: boolean;
}) {
  const rawId = useId().replace(/:/g, "");

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient
              key={s.key}
              id={`area-${rawId}-${s.key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid
          stroke="var(--color-border)"
          strokeOpacity={0.3}
          vertical={false}
        />
        <XAxis
          dataKey={xKey}
          hide={!showXAxis}
          tick={{ fill: "var(--color-muted)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={xFormatter}
          minTickGap={28}
        />
        <YAxis
          domain={yDomain ?? ["auto", "auto"]}
          width={yWidth}
          tick={{ fill: "var(--color-muted)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={yFormatter ? (v) => yFormatter(Number(v)) : undefined}
        />
        <RTooltip
          content={
            <ChartTooltip
              format={valueFormatter}
              labelFormat={xFormatter}
            />
          }
        />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            name={s.name}
            dataKey={s.key}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#area-${rawId}-${s.key})`}
            isAnimationActive={false}
            dot={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
