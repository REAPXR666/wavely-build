import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Clock,
  Cpu,
  Globe2,
  LayoutDashboard,
  MemoryStick,
  Network,
  Server,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useUiStore, type RouteId } from "@/app/store";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatusDot } from "@/components/ui/StatusDot";
import { Skeleton } from "@/components/ui/Skeleton";
import { MetricRing } from "@/components/telemetry/MetricRing";
import { Sparkline } from "@/components/telemetry/Sparkline";
import { useTelemetry } from "@/hooks/useTelemetry";
import { shieldApi } from "@/lib/ipc/shield";
import { vpnApi } from "@/lib/ipc/vpn";
import { systemApi } from "@/lib/ipc/system";
import { formatBytes, formatRate, formatUptime } from "@/lib/utils";

interface TooltipEntry {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({
  active,
  payload,
  format,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  format?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card-2/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: p.color }}
          />
          <span className="text-muted">{p.name}</span>
          <span className="ml-3 font-medium tabular-nums text-foreground">
            {p.value != null && format ? format(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function IdentityItem({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  loading: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card-2 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
        {loading ? (
          <Skeleton className="mt-1 h-4 w-24" />
        ) : (
          <p className="truncate text-sm font-medium text-foreground" title={value}>
            {value || "—"}
          </p>
        )}
      </div>
    </div>
  );
}

const MODULES: Array<{ id: RouteId; icon: LucideIcon; title: string; desc: string }> = [
  { id: "shield", icon: ShieldCheck, title: "Security", desc: "Antivirus, scanning & quarantine" },
  { id: "vpn", icon: Globe2, title: "VPN", desc: "Encrypted tunnel & servers" },
  { id: "system", icon: Cpu, title: "System", desc: "Processes, startup & diagnostics" },
];

export function DashboardPage() {
  const setRoute = useUiStore((s) => s.setRoute);
  const { latest, history } = useTelemetry();

  const overview = useQuery({
    queryKey: ["sys", "overview"],
    queryFn: systemApi.getOverview,
  });
  const shield = useQuery({ queryKey: ["shield", "status"], queryFn: shieldApi.getStatus });
  const vpn = useQuery({ queryKey: ["vpn", "status"], queryFn: vpnApi.getStatus });

  const cpu = latest ? latest.cpuUsage : 0;
  const memPct =
    latest && latest.memTotal ? (latest.memUsed / latest.memTotal) * 100 : 0;
  const rxRate = latest?.netRxRate ?? 0;
  const txRate = latest?.netTxRate ?? 0;

  const usageData = history.map((t, i) => ({
    i,
    cpu: Math.round(t.cpuUsage),
    mem: t.memTotal ? Math.round((t.memUsed / t.memTotal) * 100) : 0,
  }));
  const netData = history.map((t, i) => ({
    i,
    down: t.netRxRate,
    up: t.netTxRate,
  }));
  const cpuSeries = history.map((t) => t.cpuUsage);
  const rxSeries = history.map((t) => t.netRxRate);
  const txSeries = history.map((t) => t.netTxRate);

  const live = latest !== null;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Real-time system telemetry & engine status"
        icon={LayoutDashboard}
        actions={
          <>
            <Badge tone={shield.data?.realtimeEnabled ? "success" : "warning"}>
              <ShieldCheck className="h-3 w-3" />
              {shield.data?.realtimeEnabled ? "Protected" : "Standby"}
            </Badge>
            <Badge tone={vpn.data?.connected ? "success" : "neutral"}>
              <Globe2 className="h-3 w-3" />
              {vpn.data?.connected ? "VPN on" : "VPN off"}
            </Badge>
            <Badge tone={live ? "primary" : "neutral"}>
              <StatusDot tone={live ? "primary" : "muted"} pulse={live} />
              {live ? "Live" : "Connecting…"}
            </Badge>
          </>
        }
      />

      {/* System identity */}
      <Card className="mb-5">
        <CardContent className="grid grid-cols-2 gap-4 p-5 md:grid-cols-4 xl:grid-cols-5">
          <IdentityItem
            icon={Server}
            label="Host"
            value={overview.data?.hostName}
            loading={overview.isLoading}
          />
          <IdentityItem
            icon={Cpu}
            label="Processor"
            value={overview.data?.cpuBrand}
            loading={overview.isLoading}
          />
          <IdentityItem
            icon={MemoryStick}
            label="Memory"
            value={overview.data ? formatBytes(overview.data.memTotal) : undefined}
            loading={overview.isLoading}
          />
          <IdentityItem
            icon={LayoutDashboard}
            label="Cores"
            value={overview.data ? String(overview.data.cpuCores) : undefined}
            loading={overview.isLoading}
          />
          <IdentityItem
            icon={Clock}
            label="Uptime"
            value={overview.data ? formatUptime(overview.data.uptime) : undefined}
            loading={overview.isLoading}
          />
        </CardContent>
      </Card>

      {/* Hero telemetry */}
      <div className="grid gap-4 lg:grid-cols-3">
        <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
          <Card className="h-full">
            <CardContent className="flex flex-col items-center gap-4 p-6">
              <div className="flex w-full items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Cpu className="h-4 w-4 text-primary" /> CPU
                </span>
                <Badge tone={cpu > 85 ? "danger" : cpu > 60 ? "warning" : "primary"}>
                  {Math.round(cpu)}%
                </Badge>
              </div>
              <MetricRing value={cpu} label="Load" />
              <div className="h-10 w-full">
                <Sparkline data={cpuSeries} domain={[0, 100]} />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
          <Card className="h-full">
            <CardContent className="flex flex-col items-center gap-4 p-6">
              <div className="flex w-full items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <MemoryStick className="h-4 w-4 text-accent" /> Memory
                </span>
                <Badge tone={memPct > 85 ? "danger" : memPct > 70 ? "warning" : "primary"}>
                  {latest ? `${formatBytes(latest.memUsed)}` : "—"}
                </Badge>
              </div>
              <MetricRing
                value={memPct}
                label="Used"
                from="var(--color-accent)"
                to="var(--color-primary)"
              />
              <p className="text-xs text-muted">
                {latest
                  ? `${formatBytes(latest.memUsed)} of ${formatBytes(latest.memTotal)}`
                  : "waiting for telemetry…"}
              </p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
          <Card className="h-full">
            <CardContent className="flex h-full flex-col gap-4 p-6">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Network className="h-4 w-4 text-primary" /> Network
              </span>
              <div className="grid flex-1 grid-cols-2 gap-3">
                <div className="rounded-xl border border-border/70 bg-card-2/40 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted">
                    <ArrowDown className="h-3.5 w-3.5 text-success" /> Download
                  </div>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                    {formatRate(rxRate)}
                  </p>
                  <div className="mt-1 h-8">
                    <Sparkline data={rxSeries} color="var(--color-success)" height={32} />
                  </div>
                </div>
                <div className="rounded-xl border border-border/70 bg-card-2/40 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted">
                    <ArrowUp className="h-3.5 w-3.5 text-primary" /> Upload
                  </div>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                    {formatRate(txRate)}
                  </p>
                  <div className="mt-1 h-8">
                    <Sparkline data={txSeries} color="var(--color-primary)" height={32} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Live charts */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">
                  CPU & Memory
                </h3>
              </div>
              <span className="text-xs text-muted">last 60s</span>
            </div>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={usageData}>
                  <defs>
                    <linearGradient id="cpuArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="memArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-border)" strokeOpacity={0.3} vertical={false} />
                  <XAxis dataKey="i" hide />
                  <YAxis domain={[0, 100]} width={28} tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <RTooltip content={<ChartTooltip format={(v) => `${v}%`} />} />
                  <Area type="monotone" name="CPU" dataKey="cpu" stroke="var(--color-primary)" strokeWidth={2} fill="url(#cpuArea)" isAnimationActive={false} dot={false} />
                  <Area type="monotone" name="Memory" dataKey="mem" stroke="var(--color-accent)" strokeWidth={2} fill="url(#memArea)" isAnimationActive={false} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">
                  Network throughput
                </h3>
              </div>
              <span className="text-xs text-muted">last 60s</span>
            </div>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={netData}>
                  <defs>
                    <linearGradient id="downArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="upArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-border)" strokeOpacity={0.3} vertical={false} />
                  <XAxis dataKey="i" hide />
                  <YAxis
                    width={52}
                    tick={{ fill: "var(--color-muted)", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => formatBytes(Number(v))}
                  />
                  <RTooltip content={<ChartTooltip format={(v) => formatRate(v)} />} />
                  <Area type="monotone" name="Download" dataKey="down" stroke="var(--color-success)" strokeWidth={2} fill="url(#downArea)" isAnimationActive={false} dot={false} />
                  <Area type="monotone" name="Upload" dataKey="up" stroke="var(--color-primary)" strokeWidth={2} fill="url(#upArea)" isAnimationActive={false} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Module quick links */}
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {MODULES.map((m) => {
          const Icon = m.icon;
          return (
            <motion.button
              key={m.id}
              whileHover={{ y: -3 }}
              transition={{ duration: 0.2 }}
              onClick={() => setRoute(m.id)}
              className="app-no-drag text-left"
            >
              <Card className="h-full transition-colors hover:border-primary/30">
                <CardContent className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card-2 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{m.title}</p>
                      <p className="mt-0.5 text-xs text-muted">{m.desc}</p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted" />
                </CardContent>
              </Card>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
