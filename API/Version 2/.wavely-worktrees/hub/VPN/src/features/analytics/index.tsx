import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Clock,
  Cpu,
  Database,
  Gauge,
  Globe2,
  History,
  MemoryStick,
  Network,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusDot } from "@/components/ui/StatusDot";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  AreaTrendChart,
  BarTrendChart,
  ChartCard,
  ChartEmpty,
  ChartLegend,
  DonutChart,
  type DonutSlice,
} from "@/components/charts";
import { shieldApi } from "@/lib/ipc/shield";
import { formatBytes, formatNumber, formatRate } from "@/lib/utils";
import {
  useTrendHistory,
  useVpnStatsHistory,
} from "@/features/analytics/useAnalyticsData";
import {
  detectionsByDay,
  relativeTime,
  severityCounts,
  SEVERITY_COLOR,
  SEVERITY_ORDER,
  SEVERITY_TONE,
  normalizeSeverity,
} from "@/features/analytics/util";

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "primary",
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: "primary" | "success" | "warning" | "danger" | "accent";
  loading?: boolean;
}) {
  const toneText: Record<string, string> = {
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    accent: "text-accent",
  };
  return (
    <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
      <Card className="h-full">
        <CardContent className="flex items-center gap-3 p-4">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card-2 ${toneText[tone]}`}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-muted">
              {label}
            </p>
            {loading ? (
              <Skeleton className="mt-1.5 h-5 w-16" />
            ) : (
              <p className="truncate text-lg font-semibold tabular-nums text-foreground">
                {value}
              </p>
            )}
            {hint && <p className="mt-0.5 truncate text-[11px] text-muted">{hint}</p>}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  desc,
  right,
}: {
  icon: LucideIcon;
  title: string;
  desc?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3 mt-7 flex items-end justify-between gap-3 first:mt-0">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {desc && <p className="text-xs text-muted">{desc}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

const timeFmt = (v: string | number) =>
  new Date(Number(v)).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export function AnalyticsPage() {
  const { history, restoredCount, hydrated } = useTrendHistory();
  const vpn = useVpnStatsHistory();
  const now = Date.now();

  const threatsQuery = useQuery({
    queryKey: ["shield", "threat-log"],
    queryFn: shieldApi.getThreatLog,
  });
  const threats = threatsQuery.data ?? [];

  // ---- Performance aggregates -------------------------------------------
  const perf = useMemo(() => {
    if (history.length === 0) {
      return { avgCpu: 0, peakCpu: 0, avgMem: 0, lastRx: 0, lastTx: 0 };
    }
    const cpuVals = history.map((p) => p.cpu);
    const memVals = history.map((p) => p.mem);
    const last = history[history.length - 1];
    return {
      avgCpu: Math.round(cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length),
      peakCpu: Math.max(...cpuVals),
      avgMem: Math.round(memVals.reduce((a, b) => a + b, 0) / memVals.length),
      lastRx: last.rx,
      lastTx: last.tx,
    };
  }, [history]);

  // ---- Threat aggregates ------------------------------------------------
  const counts = useMemo(() => severityCounts(threats), [threats]);
  const dayBuckets = useMemo(
    () => detectionsByDay(threats, 14, now),
    [threats, now],
  );
  const severitySlices: DonutSlice[] = SEVERITY_ORDER.filter(
    (s) => counts[s] > 0,
  ).map((s) => ({
    name: s[0].toUpperCase() + s.slice(1),
    value: counts[s],
    color: SEVERITY_COLOR[s],
  }));
  const totalThreats = threats.length;
  const criticalHigh = counts.critical + counts.high;
  const recent = useMemo(
    () => [...threats].sort((a, b) => b.detectedAt - a.detectedAt).slice(0, 8),
    [threats],
  );

  // ---- VPN aggregates ---------------------------------------------------
  const totalRx = vpn.latest?.rxBytes ?? 0;
  const totalTx = vpn.latest?.txBytes ?? 0;
  const vpnSplit: DonutSlice[] = [
    { name: "Download", value: totalRx, color: "var(--color-success)" },
    { name: "Upload", value: totalTx, color: "var(--color-primary)" },
  ];
  const hasVpnData = totalRx + totalTx > 0 || vpn.history.some((p) => p.rx + p.tx > 0);

  const liveBadge = (
    <Badge tone={hydrated && history.length > 0 ? "primary" : "neutral"}>
      <StatusDot
        tone={history.length > 0 ? "primary" : "muted"}
        pulse={history.length > 0}
      />
      {history.length > 0 ? "Live" : "Connecting…"}
    </Badge>
  );

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Threat history, performance trends & data usage"
        icon={BarChart3}
        actions={
          <>
            {restoredCount > 0 && (
              <Tooltip content="Performance points restored from your last session via local persistence.">
                <Badge tone="neutral">
                  <History className="h-3 w-3" />
                  {restoredCount} restored
                </Badge>
              </Tooltip>
            )}
            {liveBadge}
          </>
        }
      />

      {/* KPI summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          icon={ShieldAlert}
          label="Threats logged"
          value={formatNumber(totalThreats)}
          hint="from detection history"
          tone={totalThreats > 0 ? "warning" : "success"}
          loading={threatsQuery.isLoading}
        />
        <StatTile
          icon={ShieldCheck}
          label="Critical / High"
          value={formatNumber(criticalHigh)}
          hint="high-severity detections"
          tone={criticalHigh > 0 ? "danger" : "success"}
          loading={threatsQuery.isLoading}
        />
        <StatTile
          icon={Gauge}
          label="Avg CPU load"
          value={`${perf.avgCpu}%`}
          hint={`peak ${perf.peakCpu}% · ${history.length} samples`}
          tone="primary"
          loading={!hydrated}
        />
        <StatTile
          icon={Database}
          label="VPN data (session)"
          value={formatBytes(totalRx + totalTx)}
          hint="down + up this session"
          tone="accent"
        />
      </div>

      {/* Performance trends */}
      <SectionTitle
        icon={Activity}
        title="System performance trends"
        desc="Sampled live from the system telemetry stream (1s) · recent window persisted locally"
        right={liveBadge}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="CPU & Memory"
          icon={Cpu}
          hint={`last ${history.length || 0} samples`}
        >
          {!hydrated ? (
            <Skeleton className="h-[220px] w-full rounded-xl" />
          ) : history.length === 0 ? (
            <ChartEmpty
              icon={Cpu}
              title="Waiting for telemetry"
              hint="Live CPU and memory samples appear here within a second of the engine starting."
            />
          ) : (
            <>
              <AreaTrendChart
                data={history}
                xKey="ts"
                xFormatter={timeFmt}
                yDomain={[0, 100]}
                valueFormatter={(v) => `${v}%`}
                series={[
                  { key: "cpu", name: "CPU", color: "var(--color-primary)" },
                  { key: "mem", name: "Memory", color: "var(--color-accent)" },
                ]}
              />
              <ChartLegend
                className="mt-3"
                items={[
                  {
                    label: "CPU",
                    color: "var(--color-primary)",
                    value: `${perf.avgCpu}% avg`,
                  },
                  {
                    label: "Memory",
                    color: "var(--color-accent)",
                    value: `${perf.avgMem}% avg`,
                  },
                ]}
              />
            </>
          )}
        </ChartCard>

        <ChartCard
          title="Network throughput"
          icon={Network}
          hint={`last ${history.length || 0} samples`}
        >
          {!hydrated ? (
            <Skeleton className="h-[220px] w-full rounded-xl" />
          ) : history.length === 0 ? (
            <ChartEmpty
              icon={Network}
              title="Waiting for telemetry"
              hint="Aggregate download/upload throughput across all interfaces."
            />
          ) : (
            <>
              <AreaTrendChart
                data={history}
                xKey="ts"
                xFormatter={timeFmt}
                yWidth={52}
                yFormatter={(v) => formatBytes(v)}
                valueFormatter={(v) => formatRate(v)}
                series={[
                  { key: "rx", name: "Download", color: "var(--color-success)" },
                  { key: "tx", name: "Upload", color: "var(--color-primary)" },
                ]}
              />
              <ChartLegend
                className="mt-3"
                items={[
                  {
                    label: "Download",
                    color: "var(--color-success)",
                    value: formatRate(perf.lastRx),
                  },
                  {
                    label: "Upload",
                    color: "var(--color-primary)",
                    value: formatRate(perf.lastTx),
                  },
                ]}
              />
            </>
          )}
        </ChartCard>
      </div>

      {/* Threat history */}
      <SectionTitle
        icon={ShieldAlert}
        title="Threat detection history"
        desc="Aggregated from the Shield engine's threat log"
        right={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => threatsQuery.refetch()}
            disabled={threatsQuery.isFetching}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${threatsQuery.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Severity breakdown" icon={ShieldAlert}>
          {threatsQuery.isLoading ? (
            <Skeleton className="h-[220px] w-full rounded-xl" />
          ) : totalThreats === 0 ? (
            <ChartEmpty
              icon={ShieldCheck}
              title="No threats detected"
              hint="When the Shield engine logs detections, their severity mix appears here."
            />
          ) : (
            <>
              <DonutChart
                data={severitySlices}
                centerValue={formatNumber(totalThreats)}
                centerLabel="threats"
              />
              <ChartLegend
                className="mt-3 justify-center"
                items={severitySlices.map((s) => ({
                  label: s.name,
                  color: s.color,
                  value: String(s.value),
                }))}
              />
            </>
          )}
        </ChartCard>

        <ChartCard
          title="Detections over time"
          icon={BarChart3}
          hint="last 14 days"
          className="lg:col-span-2"
        >
          {threatsQuery.isLoading ? (
            <Skeleton className="h-[220px] w-full rounded-xl" />
          ) : totalThreats === 0 ? (
            <ChartEmpty
              icon={BarChart3}
              title="No detection activity"
              hint="A stacked daily breakdown of detections by severity will render here."
            />
          ) : (
            <>
              <BarTrendChart
                data={dayBuckets}
                xKey="day"
                series={SEVERITY_ORDER.map((s) => ({
                  key: s,
                  name: s[0].toUpperCase() + s.slice(1),
                  color: SEVERITY_COLOR[s],
                  stackId: "sev",
                }))}
              />
              <ChartLegend
                className="mt-3"
                items={SEVERITY_ORDER.map((s) => ({
                  label: s[0].toUpperCase() + s.slice(1),
                  color: SEVERITY_COLOR[s],
                }))}
              />
            </>
          )}
        </ChartCard>
      </div>

      {/* VPN usage */}
      <SectionTitle
        icon={Globe2}
        title="VPN usage & data transfer"
        desc="Live tunnel throughput for the current session"
        right={
          <Tooltip content="VPN totals reflect the active session and reset when the app restarts.">
            <Badge tone="neutral">Session only</Badge>
          </Tooltip>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Transfer split" icon={Database}>
          {!hasVpnData ? (
            <ChartEmpty
              icon={Globe2}
              title="No VPN traffic yet"
              hint="Connect the VPN to see download vs. upload volume for the session."
            />
          ) : (
            <>
              <DonutChart
                data={vpnSplit}
                centerValue={formatBytes(totalRx + totalTx)}
                centerLabel="total"
                valueFormatter={(v) => formatBytes(v)}
              />
              <ChartLegend
                className="mt-3 justify-center"
                items={[
                  {
                    label: "Download",
                    color: "var(--color-success)",
                    value: formatBytes(totalRx),
                  },
                  {
                    label: "Upload",
                    color: "var(--color-primary)",
                    value: formatBytes(totalTx),
                  },
                ]}
              />
            </>
          )}
        </ChartCard>

        <ChartCard
          title="Throughput (session)"
          icon={Network}
          hint="live"
          className="lg:col-span-2"
        >
          {vpn.history.length === 0 ? (
            <ChartEmpty
              icon={Network}
              title="Awaiting VPN stats"
              hint="Per-second download and upload rates stream in once a tunnel is active."
            />
          ) : (
            <>
              <AreaTrendChart
                data={vpn.history}
                xKey="ts"
                xFormatter={timeFmt}
                yWidth={52}
                yFormatter={(v) => formatBytes(v)}
                valueFormatter={(v) => formatRate(v)}
                series={[
                  { key: "rx", name: "Download", color: "var(--color-success)" },
                  { key: "tx", name: "Upload", color: "var(--color-primary)" },
                ]}
              />
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border/70 bg-card-2/40 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted">
                    <ArrowDown className="h-3.5 w-3.5 text-success" /> Download
                  </div>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                    {formatRate(vpn.latest?.rxRate ?? 0)}
                  </p>
                </div>
                <div className="rounded-xl border border-border/70 bg-card-2/40 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted">
                    <ArrowUp className="h-3.5 w-3.5 text-primary" /> Upload
                  </div>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                    {formatRate(vpn.latest?.txRate ?? 0)}
                  </p>
                </div>
              </div>
            </>
          )}
        </ChartCard>
      </div>

      {/* Activity timeline */}
      <SectionTitle
        icon={History}
        title="Recent activity"
        desc="Latest detection events from the Shield engine"
      />
      <Card>
        <CardContent className="p-5">
          {threatsQuery.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card-2 text-success">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium text-foreground">All clear</p>
              <p className="max-w-sm text-xs text-muted">
                No detection events have been recorded yet. Activity from
                real-time protection and scans will appear here as a timeline.
              </p>
            </div>
          ) : (
            <ol className="relative space-y-1 pl-5">
              <span className="absolute bottom-2 left-[7px] top-2 w-px bg-border" />
              {recent.map((t) => {
                const sev = normalizeSeverity(t.severity);
                return (
                  <li key={t.id} className="relative">
                    <span
                      className="absolute -left-[13px] top-3 h-2.5 w-2.5 rounded-full ring-4 ring-card"
                      style={{ background: SEVERITY_COLOR[sev] }}
                    />
                    <div className="flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-card-2/50">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {t.name || "Unknown threat"}
                          </span>
                          <Badge tone={SEVERITY_TONE[sev]}>{sev}</Badge>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted" title={t.path}>
                          {t.path || "—"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone="neutral">{t.action}</Badge>
                        <span className="flex items-center gap-1 text-[11px] text-muted">
                          <Clock className="h-3 w-3" />
                          {relativeTime(t.detectedAt, now)}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted">
        <MemoryStick className="h-3 w-3" />
        Performance trends are sampled live and persisted locally; threat &amp;
        VPN figures reflect data reported by their engines.
      </p>
    </div>
  );
}
