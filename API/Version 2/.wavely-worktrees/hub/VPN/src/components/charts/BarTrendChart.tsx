import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "./ChartTooltip";

export interface BarSeries {
  key: string;
  name: string;
  color: string;
  stackId?: string;
}

/**
 * Reusable (optionally stacked) bar chart for categorical / time-bucketed data
 * such as detections per day or scans per category. Pass `colorBy` to color
 * each bar of a single series individually (e.g. by severity).
 */
export function BarTrendChart<T extends object>({
  data,
  series,
  xKey,
  height = 220,
  yWidth = 32,
  yFormatter,
  valueFormatter,
  xFormatter,
  colorBy,
}: {
  data: T[];
  series: BarSeries[];
  xKey: string;
  height?: number;
  yWidth?: number;
  yFormatter?: (v: number) => string;
  valueFormatter?: (v: number) => string;
  xFormatter?: (v: string | number) => string;
  /** When set (single series), returns a per-datum bar color. */
  colorBy?: (datum: T, index: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
        <CartesianGrid
          stroke="var(--color-border)"
          strokeOpacity={0.3}
          vertical={false}
        />
        <XAxis
          dataKey={xKey}
          tick={{ fill: "var(--color-muted)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={xFormatter}
          minTickGap={16}
        />
        <YAxis
          allowDecimals={false}
          width={yWidth}
          tick={{ fill: "var(--color-muted)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={yFormatter ? (v) => yFormatter(Number(v)) : undefined}
        />
        <RTooltip
          cursor={{ fill: "var(--color-card-2)", opacity: 0.4 }}
          content={<ChartTooltip format={valueFormatter} labelFormat={xFormatter} />}
        />
        {series.map((s) => (
          <Bar
            key={s.key}
            name={s.name}
            dataKey={s.key}
            stackId={s.stackId}
            fill={s.color}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
            maxBarSize={48}
          >
            {colorBy &&
              data.map((d, i) => (
                <Cell key={i} fill={colorBy(d, i)} />
              ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
